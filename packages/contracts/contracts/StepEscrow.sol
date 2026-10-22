// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Минимальный интерфейс токена. В продукте это цифровой рубль, в тестовой сети тестовый токен.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

/**
 * @title StepEscrow
 * @notice Эталонный контракт StepPay: деньги резервируются и уходят исполнителю по принятым этапам.
 * Логика повторяет ядро сделок из packages/engine: три режима (своя сделка, краудфандинг, грант),
 * подписи сторон, голосование спонсоров, спор с приемщиком, автоприемка, пропорциональные выплаты и возвраты,
 * неустойка за просрочку этапа в пользу заказчика.
 * Контракт хранит хеш условий (SHA-256 от канонической записи, как в шаге 1), поэтому условия сделки
 * в ядре и в контракте можно сверить.
 *
 * Инвариант денег: токены на балансе контракта равны сумме резервов по всем сделкам (totalLocked),
 * резервы каждой сделки расходуются только на выплаты и возвраты.
 */
contract StepEscrow {
    enum Mode { Own, Crowdfunding, Grant }
    enum DealStatus { Funding, Active, Completed, Cancelled }
    enum StageStatus { Pending, Active, Submitted, Accepted, Disputed, Failed }
    enum Vote { None, Accept, Reject }

    struct Stage {
        uint128 amount;
        StageStatus status;
        uint64 submittedAt;
        bytes32 evidence; // хеш материалов сдачи (описание и фото лежат вне цепочки)
        uint64 activeSince; // когда этап пошел в работу: от этого считается срок этапа
        uint64 disputedAt; // когда начался спор: от этого считается срок решения
        uint128 penalty; // неустойка за просрочку: считается при сдаче, удерживается из выплаты и возвращается заказчику
    }

    /// @dev Сроки в секундах, ноль значит «без срока». Нужны для аварийного выхода, если сторона пропала.
    struct Deadlines {
        uint64 fundingSecs; // сбор денег, от создания сделки
        uint64 stageSecs; // выполнение этапа, от начала работы над ним
        uint64 disputeSecs; // решение спора приемщиком, от открытия спора
    }

    /// @dev Неустойка за просрочку этапа (только своя сделка, нужен срок этапа). Ноль: без неустойки.
    /// За каждые начатые сутки после срока удерживается bpsPerDay суммы этапа, но не больше capBps.
    /// Пока неустойка не дошла до предела, этап можно сдать; после этого срабатывает выход по сроку.
    struct Penalty {
        uint16 bpsPerDay;
        uint16 capBps;
    }

    struct Params {
        Mode mode;
        address executor;
        address owner;
        address arbiter;
        uint64 autoAcceptSecs;
        uint16 feeBps;
        bytes32 contractHash;
        Deadlines deadlines;
        address backupArbiter;
        Penalty penalty;
    }

    struct Deal {
        Mode mode;
        DealStatus status;
        address executor;
        address owner; // заказчик или грантодатель; у краудфандинга нулевой адрес
        address arbiter; // независимый приемщик (только своя сделка)
        address backupArbiter; // запасной приемщик: решает спор, если основной молчит половину срока на спор
        bool executorSigned;
        bool ownerSigned;
        uint16 feeBps;
        uint64 autoAcceptSecs;
        uint64 createdAt;
        Deadlines deadlines;
        Penalty penalty;
        bytes32 contractHash;
        uint256 target;
        uint256 totalReserved;
        uint256 totalContributed;
        address[] funders;
        Stage[] stages;
    }

    uint256 public constant MAX_STAGES = 32;
    uint256 public constant MAX_FUNDERS = 64;
    uint16 public constant MAX_FEE_BPS = 1000;
    uint16 public constant MAX_PENALTY_BPS = 5000;

    IERC20 public immutable token;
    address public immutable feeRecipient;

    uint256 public dealCount;
    /// @notice сколько токенов сейчас заперто в резервах всех сделок
    uint256 public totalLocked;
    /// @notice сколько токенов контракт задолжал получателям, которым перевод не удался (см. claim)
    uint256 public totalOwed;
    mapping(address => uint256) public owed;

    mapping(uint256 => Deal) private deals;
    mapping(uint256 => mapping(address => uint256)) public reserves;
    mapping(uint256 => mapping(address => uint256)) public contributed;
    mapping(uint256 => mapping(uint256 => mapping(address => Vote))) public votes;
    mapping(uint256 => mapping(uint256 => uint256)) private acceptWeight;
    mapping(uint256 => mapping(uint256 => uint256)) private rejectWeight;

    uint256 private locked = 1;

    event DealCreated(uint256 indexed dealId, Mode mode, address indexed executor, address indexed owner, address arbiter, bytes32 contractHash, uint256 target);
    event Signed(uint256 indexed dealId, address indexed who);
    event Funded(uint256 indexed dealId, address indexed from, uint256 amount, uint256 totalReserved);
    event Activated(uint256 indexed dealId);
    event StageSubmitted(uint256 indexed dealId, uint256 indexed stage, bytes32 evidence);
    event StageAccepted(uint256 indexed dealId, uint256 indexed stage, string closedBy);
    event StageFailed(uint256 indexed dealId, uint256 indexed stage, string closedBy);
    event StageRejected(uint256 indexed dealId, uint256 indexed stage, bytes32 reason);
    event Voted(uint256 indexed dealId, uint256 indexed stage, address indexed voter, bool accept);
    event DisputeOpened(uint256 indexed dealId, uint256 indexed stage, address indexed by, bytes32 reason);
    event Payout(uint256 indexed dealId, uint256 indexed stage, address indexed executor, uint256 amount, uint256 fee);
    /// @notice неустойка за просрочку этапа удержана из выплаты и возвращена заказчику
    event PenaltyPaid(uint256 indexed dealId, uint256 indexed stage, address indexed owner, uint256 amount);
    event Refund(uint256 indexed dealId, address indexed to, uint256 amount);
    event Completed(uint256 indexed dealId);
    event Cancelled(uint256 indexed dealId, address indexed by);
    event FundingExpired(uint256 indexed dealId);
    /// @dev перевод получателю не удался (токен отказал), сумма записана ему в долг и ждет claim
    event Owed(address indexed to, uint256 amount);
    event Claimed(address indexed from, address indexed to, uint256 amount);

    error Unauthorized();
    error BadState();
    error BadInput();

    modifier nonReentrant() {
        if (locked != 1) revert BadState();
        locked = 2;
        _;
        locked = 1;
    }

    constructor(IERC20 token_, address feeRecipient_) {
        if (address(token_) == address(0) || feeRecipient_ == address(0)) revert BadInput();
        if (address(token_).code.length == 0) revert BadInput(); // токен должен быть контрактом
        token = token_;
        feeRecipient = feeRecipient_;
    }

    // ───────────────────────── создание и подписи ─────────────────────────

    /// @param owner заказчик (своя сделка) или грантодатель; для краудфандинга нулевой адрес
    /// @param arbiter приемщик споров: обязателен в своей сделке, в остальных режимах нулевой
    /// @param contractHash SHA-256 условий из ядра сделок
    function createDeal(
        Mode mode,
        address executor,
        address owner,
        address arbiter,
        uint128[] calldata stageAmounts,
        uint64 autoAcceptSecs,
        uint16 feeBps,
        bytes32 contractHash
    ) external returns (uint256) {
        return _create(Params(mode, executor, owner, arbiter, autoAcceptSecs, feeBps, contractHash, Deadlines(0, 0, 0), address(0), Penalty(0, 0)), stageAmounts);
    }

    /// @notice То же, что createDeal, плюс сроки аварийного выхода (ноль: без срока).
    function createDealEx(
        Mode mode,
        address executor,
        address owner,
        address arbiter,
        uint128[] calldata stageAmounts,
        uint64 autoAcceptSecs,
        uint16 feeBps,
        bytes32 contractHash,
        Deadlines calldata deadlines
    ) external returns (uint256) {
        return _create(Params(mode, executor, owner, arbiter, autoAcceptSecs, feeBps, contractHash, deadlines, address(0), Penalty(0, 0)), stageAmounts);
    }

    /// @notice То же, что createDealEx, плюс запасной приемщик (нужен срок на спор, решать он может со второй половины срока).
    function createDealFull(
        Mode mode,
        address executor,
        address owner,
        address arbiter,
        uint128[] calldata stageAmounts,
        uint64 autoAcceptSecs,
        uint16 feeBps,
        bytes32 contractHash,
        Deadlines calldata deadlines,
        address backupArbiter
    ) external returns (uint256) {
        return _create(Params(mode, executor, owner, arbiter, autoAcceptSecs, feeBps, contractHash, deadlines, backupArbiter, Penalty(0, 0)), stageAmounts);
    }

    /// @notice Создание сделки со всеми условиями одной структурой, включая неустойку за просрочку этапа
    /// (своя сделка, нужен срок этапа). Поля те же, что у createDealFull.
    function createDealWith(Params calldata p, uint128[] calldata stageAmounts) external returns (uint256) {
        return _create(p, stageAmounts);
    }

    function _create(Params memory p, uint128[] calldata stageAmounts) private returns (uint256 dealId) {
        if (p.executor == address(0) || stageAmounts.length == 0 || stageAmounts.length > MAX_STAGES) revert BadInput();
        if (p.feeBps > MAX_FEE_BPS) revert BadInput();
        if (p.mode == Mode.Crowdfunding) {
            if (p.owner != address(0) || p.arbiter != address(0)) revert BadInput();
        } else {
            if (p.owner == address(0) || p.owner == p.executor) revert BadInput();
            if (p.mode == Mode.Own ? p.arbiter == address(0) : p.arbiter != address(0)) revert BadInput();
        }
        if (p.arbiter == p.executor || (p.arbiter != address(0) && p.arbiter == p.owner)) revert BadInput();
        if (p.mode != Mode.Grant && p.autoAcceptSecs == 0) revert BadInput();
        if (p.mode != Mode.Own && p.deadlines.disputeSecs != 0) revert BadInput(); // споры по приемщику только в своей сделке
        if (p.penalty.bpsPerDay != 0 || p.penalty.capBps != 0) {
            // неустойка: только своя сделка со сроком этапа, ставка не больше предела, предел не больше половины этапа
            if (p.mode != Mode.Own || p.deadlines.stageSecs == 0) revert BadInput();
            if (p.penalty.bpsPerDay == 0 || p.penalty.capBps == 0 || p.penalty.bpsPerDay > p.penalty.capBps || p.penalty.capBps > MAX_PENALTY_BPS) revert BadInput();
        }
        if (p.backupArbiter != address(0)) {
            // запасной приемщик: только в своей сделке, при сроке на спор и независимый от сторон и основного
            if (p.mode != Mode.Own || p.deadlines.disputeSecs == 0) revert BadInput();
            if (p.backupArbiter == p.arbiter || p.backupArbiter == p.executor || p.backupArbiter == p.owner) revert BadInput();
        }

        dealId = ++dealCount;
        Deal storage d = deals[dealId];
        d.mode = p.mode;
        d.executor = p.executor;
        d.owner = p.owner;
        d.arbiter = p.arbiter;
        d.backupArbiter = p.backupArbiter;
        d.feeBps = p.feeBps;
        d.autoAcceptSecs = p.autoAcceptSecs;
        d.createdAt = uint64(block.timestamp);
        d.deadlines = p.deadlines;
        d.penalty = p.penalty;
        d.contractHash = p.contractHash;
        uint256 sum;
        for (uint256 i = 0; i < stageAmounts.length; i++) {
            if (stageAmounts[i] == 0) revert BadInput();
            d.stages.push(Stage({amount: stageAmounts[i], status: StageStatus.Pending, submittedAt: 0, evidence: bytes32(0), activeSince: 0, disputedAt: 0, penalty: 0}));
            sum += stageAmounts[i];
        }
        d.target = sum;
        emit DealCreated(dealId, p.mode, p.executor, p.owner, p.arbiter, p.contractHash, sum);
    }

    /// @notice Подпись стороны. Подписывают исполнитель и заказчик (грантодатель); у краудфандинга только автор.
    function sign(uint256 dealId) external {
        Deal storage d = _deal(dealId);
        if (d.status != DealStatus.Funding) revert BadState();
        if (msg.sender == d.executor) {
            if (d.executorSigned) revert BadState();
            d.executorSigned = true;
        } else if (d.mode != Mode.Crowdfunding && msg.sender == d.owner) {
            if (d.ownerSigned) revert BadState();
            d.ownerSigned = true;
        } else {
            revert Unauthorized();
        }
        emit Signed(dealId, msg.sender);
        _tryActivate(dealId, d);
    }

    function isSigned(uint256 dealId) public view returns (bool) {
        Deal storage d = deals[dealId];
        return d.executorSigned && (d.mode == Mode.Crowdfunding || d.ownerSigned);
    }

    // ───────────────────────── резерв ─────────────────────────

    /// @notice Резерв. Своя сделка и грант: ровно вся сумма от заказчика. Краудфандинг: любые взносы до цели.
    /// Нужно предварительно разрешить контракту списание через token.approve.
    function fund(uint256 dealId, uint256 amount) external nonReentrant {
        Deal storage d = _deal(dealId);
        if (d.status != DealStatus.Funding) revert BadState();
        if (amount == 0 || d.totalReserved >= d.target) revert BadInput();
        if (d.mode == Mode.Crowdfunding) {
            if (msg.sender == d.executor) revert Unauthorized();
            if (amount > d.target - d.totalReserved) revert BadInput();
        } else {
            if (msg.sender != d.owner) revert Unauthorized();
            if (amount != d.target) revert BadInput();
        }
        if (contributed[dealId][msg.sender] == 0) {
            if (d.funders.length >= MAX_FUNDERS) revert BadState();
            d.funders.push(msg.sender);
        }
        reserves[dealId][msg.sender] += amount;
        contributed[dealId][msg.sender] += amount;
        d.totalReserved += amount;
        d.totalContributed += amount;
        totalLocked += amount;
        _pull(msg.sender, amount);
        emit Funded(dealId, msg.sender, amount, d.totalReserved);
        _tryActivate(dealId, d);
    }

    function _tryActivate(uint256 dealId, Deal storage d) private {
        if (d.status == DealStatus.Funding && d.totalReserved == d.target && isSigned(dealId)) {
            d.status = DealStatus.Active;
            d.stages[0].status = StageStatus.Active;
            d.stages[0].activeSince = uint64(block.timestamp);
            emit Activated(dealId);
        }
    }

    // ───────────────────────── этапы ─────────────────────────

    function submitStage(uint256 dealId, uint256 stage, bytes32 evidence) external {
        Deal storage d = _deal(dealId);
        if (msg.sender != d.executor) revert Unauthorized();
        Stage storage st = _stage(d, stage);
        if (d.status != DealStatus.Active || st.status != StageStatus.Active) revert BadState();
        st.status = StageStatus.Submitted;
        st.submittedAt = uint64(block.timestamp);
        st.evidence = evidence;
        st.penalty = uint128(_penaltyAt(d, st, block.timestamp));
        emit StageSubmitted(dealId, stage, evidence);
    }

    /// @notice Приемка заказчиком (своя сделка) или грантодателем.
    function approveStage(uint256 dealId, uint256 stage) external nonReentrant {
        Deal storage d = _deal(dealId);
        if (d.mode == Mode.Crowdfunding) revert BadState();
        if (msg.sender != d.owner) revert Unauthorized();
        Stage storage st = _stage(d, stage);
        if (st.status != StageStatus.Submitted) revert BadState();
        _accept(dealId, d, stage, "owner");
    }

    /// @notice Отказ с причиной. Своя сделка: спор. Грант: этап провален, остаток возвращается.
    function rejectStage(uint256 dealId, uint256 stage, bytes32 reason) external nonReentrant {
        Deal storage d = _deal(dealId);
        if (d.mode == Mode.Crowdfunding) revert BadState();
        if (msg.sender != d.owner) revert Unauthorized();
        if (reason == bytes32(0)) revert BadInput();
        Stage storage st = _stage(d, stage);
        if (st.status != StageStatus.Submitted) revert BadState();
        emit StageRejected(dealId, stage, reason);
        if (d.mode == Mode.Grant) {
            _fail(dealId, d, stage, "owner");
        } else {
            st.status = StageStatus.Disputed;
            st.disputedAt = uint64(block.timestamp);
            emit DisputeOpened(dealId, stage, msg.sender, reason);
        }
    }

    /// @notice Голос спонсора, вес равен внесенной сумме. Больше половины «за» принимает этап,
    /// половина и больше «против» проваливает его. Голос можно изменить, пока этап не закрыт.
    function vote(uint256 dealId, uint256 stage, bool accept) external nonReentrant {
        Deal storage d = _deal(dealId);
        if (d.mode != Mode.Crowdfunding) revert BadState();
        uint256 w = contributed[dealId][msg.sender];
        if (w == 0) revert Unauthorized();
        Stage storage st = _stage(d, stage);
        if (st.status != StageStatus.Submitted) revert BadState();

        Vote prev = votes[dealId][stage][msg.sender];
        if (prev == Vote.Accept) acceptWeight[dealId][stage] -= w;
        else if (prev == Vote.Reject) rejectWeight[dealId][stage] -= w;
        votes[dealId][stage][msg.sender] = accept ? Vote.Accept : Vote.Reject;
        if (accept) acceptWeight[dealId][stage] += w;
        else rejectWeight[dealId][stage] += w;
        emit Voted(dealId, stage, msg.sender, accept);

        if (acceptWeight[dealId][stage] * 2 > d.totalContributed) _accept(dealId, d, stage, "votes");
        else if (rejectWeight[dealId][stage] * 2 >= d.totalContributed) _fail(dealId, d, stage, "votes");
    }

    /// @notice Спор по сданному этапу (своя сделка): открывает заказчик или исполнитель.
    function openDispute(uint256 dealId, uint256 stage, bytes32 reason) external {
        Deal storage d = _deal(dealId);
        if (d.mode != Mode.Own) revert BadState();
        if (msg.sender != d.owner && msg.sender != d.executor) revert Unauthorized();
        if (reason == bytes32(0)) revert BadInput();
        Stage storage st = _stage(d, stage);
        if (st.status != StageStatus.Submitted) revert BadState();
        st.status = StageStatus.Disputed;
        st.disputedAt = uint64(block.timestamp);
        emit DisputeOpened(dealId, stage, msg.sender, reason);
    }

    /// @notice Решение приемщика: pay выплачивает исполнителю, иначе остаток возвращается заказчику.
    function resolveDispute(uint256 dealId, uint256 stage, bool pay) external nonReentrant {
        Deal storage d = _deal(dealId);
        Stage storage st = _stage(d, stage);
        bool primary = d.arbiter != address(0) && msg.sender == d.arbiter;
        bool backup = d.backupArbiter != address(0) && msg.sender == d.backupArbiter;
        if (!primary && !backup) revert Unauthorized();
        if (st.status != StageStatus.Disputed) revert BadState();
        // запасной приемщик решает со второй половины срока на спор
        if (!primary && block.timestamp < uint256(st.disputedAt) + d.deadlines.disputeSecs / 2) revert BadState();
        if (pay) _accept(dealId, d, stage, "arbiter");
        else _fail(dealId, d, stage, "arbiter");
    }

    /// @notice Автоприемка: если ответа нет дольше autoAcceptSecs, любой может принять этап (своя сделка и краудфандинг).
    function autoAccept(uint256 dealId, uint256 stage) external nonReentrant {
        Deal storage d = _deal(dealId);
        if (d.mode == Mode.Grant || d.status != DealStatus.Active) revert BadState();
        Stage storage st = _stage(d, stage);
        if (st.status != StageStatus.Submitted) revert BadState();
        if (block.timestamp < uint256(st.submittedAt) + d.autoAcceptSecs) revert BadState();
        _accept(dealId, d, stage, "auto");
    }

    /// @notice Отмена: заказчик (своя сделка, грант) или автор (краудфандинг). Остаток резерва возвращается.
    function cancel(uint256 dealId) external nonReentrant {
        Deal storage d = _deal(dealId);
        if (d.status != DealStatus.Funding && d.status != DealStatus.Active) revert BadState();
        if (msg.sender != (d.mode == Mode.Crowdfunding ? d.executor : d.owner)) revert Unauthorized();
        for (uint256 i = 0; i < d.stages.length; i++) {
            StageStatus s = d.stages[i].status;
            if (s == StageStatus.Submitted || s == StageStatus.Disputed) revert BadState();
        }
        d.status = DealStatus.Cancelled;
        emit Cancelled(dealId, msg.sender);
        _refundAll(dealId, d);
    }

    // ───────────────────────── сроки и аварийный выход ─────────────────────────
    // Вызвать может любой: после срока деньги возвращаются без чьего-либо согласия.

    /// @notice Сбор не завершился в срок: сделка отменяется, все резервы возвращаются.
    function expireFunding(uint256 dealId) external nonReentrant {
        Deal storage d = _deal(dealId);
        if (d.status != DealStatus.Funding || d.deadlines.fundingSecs == 0) revert BadState();
        if (block.timestamp < uint256(d.createdAt) + d.deadlines.fundingSecs) revert BadState();
        d.status = DealStatus.Cancelled;
        emit FundingExpired(dealId);
        _refundAll(dealId, d);
    }

    /// @notice Исполнитель не сдал этап в срок: этап провален, остаток возвращается спонсорам.
    function expireStage(uint256 dealId, uint256 stage) external nonReentrant {
        Deal storage d = _deal(dealId);
        Stage storage st = _stage(d, stage);
        if (d.status != DealStatus.Active || st.status != StageStatus.Active || d.deadlines.stageSecs == 0) revert BadState();
        if (block.timestamp < uint256(st.activeSince) + d.deadlines.stageSecs + _graceSecs(d)) revert BadState();
        _fail(dealId, d, stage, "expired");
    }

    /// @notice Приемщик не решил спор в срок: этап провален, остаток возвращается заказчику.
    function expireDispute(uint256 dealId, uint256 stage) external nonReentrant {
        Deal storage d = _deal(dealId);
        Stage storage st = _stage(d, stage);
        if (d.status != DealStatus.Active || st.status != StageStatus.Disputed || d.deadlines.disputeSecs == 0) revert BadState();
        if (block.timestamp < uint256(st.disputedAt) + d.deadlines.disputeSecs) revert BadState();
        _fail(dealId, d, stage, "expired");
    }

    // ───────────────────────── неустойка ─────────────────────────

    /// @dev Сутки после срока, за которые неустойка доходит до предела: столько этап еще можно сдать.
    function _graceSecs(Deal storage d) private view returns (uint256) {
        if (d.penalty.bpsPerDay == 0) return 0;
        return ((uint256(d.penalty.capBps) + d.penalty.bpsPerDay - 1) / d.penalty.bpsPerDay) * 1 days;
    }

    /// @dev Неустойка при сдаче в момент at: сдача в момент срока и позже считается просрочкой
    /// с первых суток, далее за каждые начатые сутки; не больше предела.
    function _penaltyAt(Deal storage d, Stage storage st, uint256 at) private view returns (uint256) {
        if (d.penalty.bpsPerDay == 0) return 0;
        uint256 due = uint256(st.activeSince) + d.deadlines.stageSecs;
        if (at < due) return 0;
        uint256 bps = ((at - due) / 1 days + 1) * d.penalty.bpsPerDay;
        if (bps > d.penalty.capBps) bps = d.penalty.capBps;
        return (uint256(st.amount) * bps) / 10_000;
    }

    // ───────────────────────── движение денег ─────────────────────────

    function _accept(uint256 dealId, Deal storage d, uint256 stage, string memory closedBy) private {
        Stage storage st = d.stages[stage];
        _payout(dealId, d, stage, st.amount, st.penalty);
        st.status = StageStatus.Accepted;
        emit StageAccepted(dealId, stage, closedBy);
        if (stage + 1 < d.stages.length) {
            d.stages[stage + 1].status = StageStatus.Active;
            d.stages[stage + 1].activeSince = uint64(block.timestamp);
        } else {
            d.status = DealStatus.Completed;
            emit Completed(dealId);
            _refundAll(dealId, d); // страховка: после последнего этапа в резерве ничего не остается
        }
    }

    function _fail(uint256 dealId, Deal storage d, uint256 stage, string memory closedBy) private {
        d.stages[stage].status = StageStatus.Failed;
        d.status = DealStatus.Cancelled;
        emit StageFailed(dealId, stage, closedBy);
        _refundAll(dealId, d);
    }

    /// @dev Сумма этапа списывается с резервов пропорционально. Неустойка возвращается заказчику,
    /// исполнитель получает остаток за вычетом комиссии (комиссия считается с суммы после неустойки).
    function _payout(uint256 dealId, Deal storage d, uint256 stage, uint256 amount, uint256 penalty) private {
        uint256[] memory parts = _split(dealId, d, amount);
        uint256 paid;
        for (uint256 i = 0; i < parts.length; i++) {
            address f = d.funders[i];
            reserves[dealId][f] -= parts[i];
            paid += parts[i];
        }
        if (paid != amount) revert BadState();
        d.totalReserved -= amount;
        totalLocked -= amount;
        uint256 net = amount - penalty;
        uint256 fee = (net * d.feeBps) / 10_000;
        emit Payout(dealId, stage, d.executor, net - fee, fee);
        _push(d.executor, net - fee);
        if (fee > 0) _push(feeRecipient, fee);
        if (penalty > 0) {
            emit PenaltyPaid(dealId, stage, d.owner, penalty);
            _push(d.owner, penalty);
        }
    }

    function _refundAll(uint256 dealId, Deal storage d) private {
        for (uint256 i = 0; i < d.funders.length; i++) {
            address f = d.funders[i];
            uint256 left = reserves[dealId][f];
            if (left == 0) continue;
            reserves[dealId][f] = 0;
            d.totalReserved -= left;
            totalLocked -= left;
            emit Refund(dealId, f, left);
            _push(f, left);
        }
    }

    /// @dev Деление суммы по весам (резервам) методом наибольших остатков, как splitProRata в ядре.
    function _split(uint256 dealId, Deal storage d, uint256 amount) private view returns (uint256[] memory parts) {
        uint256 n = d.funders.length;
        uint256 total = d.totalReserved;
        parts = new uint256[](n);
        uint256[] memory rem = new uint256[](n);
        uint256 given;
        for (uint256 i = 0; i < n; i++) {
            uint256 w = reserves[dealId][d.funders[i]];
            uint256 exact = amount * w;
            parts[i] = exact / total;
            rem[i] = exact % total;
            given += parts[i];
        }
        uint256 left = amount - given;
        while (left > 0) {
            uint256 best = type(uint256).max;
            uint256 bestRem;
            for (uint256 i = 0; i < n; i++) {
                if (rem[i] > bestRem) {
                    bestRem = rem[i];
                    best = i;
                }
            }
            if (best == type(uint256).max) revert BadState();
            parts[best] += 1;
            rem[best] = 0;
            left -= 1;
        }
    }

    // ───────────────────────── токен ─────────────────────────

    /// @dev Списывает токены с отправителя. Если на баланс контракта пришло не ровно amount (токен с комиссией при переводе,
    /// ребейз), операция откатывается: такие токены не поддерживаются, чтобы не нарушить учет резервов.
    function _pull(address from, uint256 amount) private {
        uint256 before = token.balanceOf(address(this));
        (bool ok, bytes memory ret) = address(token).call(abi.encodeCall(IERC20.transferFrom, (from, address(this), amount)));
        if (!ok || (ret.length != 0 && (ret.length < 32 || !abi.decode(ret, (bool))))) revert BadState();
        if (token.balanceOf(address(this)) - before != amount) revert BadState();
    }

    /// @dev Переводит токены получателю. Если токен отказал (черный список, запрет получения), один получатель не должен
    /// блокировать остальных: сумма записывается ему в долг, а забрать ее он может сам через claim.
    function _push(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, bytes memory ret) = address(token).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (!ok || (ret.length != 0 && (ret.length < 32 || !abi.decode(ret, (bool))))) {
            owed[to] += amount;
            totalOwed += amount;
            emit Owed(to, amount);
        }
    }

    /// @notice Забрать то, что не удалось перевести автоматически. Можно указать другой адрес, если на основной токен не идет.
    function claim(address to) external nonReentrant {
        if (to == address(0)) revert BadInput();
        uint256 amount = owed[msg.sender];
        if (amount == 0) revert BadState();
        owed[msg.sender] = 0;
        totalOwed -= amount;
        (bool ok, bytes memory ret) = address(token).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (!ok || (ret.length != 0 && (ret.length < 32 || !abi.decode(ret, (bool))))) revert BadState();
        emit Claimed(msg.sender, to, amount);
    }

    // ───────────────────────── чтение ─────────────────────────

    function _deal(uint256 dealId) private view returns (Deal storage d) {
        if (dealId == 0 || dealId > dealCount) revert BadInput();
        d = deals[dealId];
    }

    function _stage(Deal storage d, uint256 stage) private view returns (Stage storage) {
        if (stage >= d.stages.length) revert BadInput();
        return d.stages[stage];
    }

    function getDeal(uint256 dealId)
        external
        view
        returns (Mode mode, DealStatus status, address executor, address owner, address arbiter, bytes32 contractHash, uint256 target, uint256 totalReserved, uint256 stageCount)
    {
        Deal storage d = _deal(dealId);
        return (d.mode, d.status, d.executor, d.owner, d.arbiter, d.contractHash, d.target, d.totalReserved, d.stages.length);
    }

    function getStage(uint256 dealId, uint256 stage) external view returns (uint128 amount, StageStatus status, uint64 submittedAt, bytes32 evidence) {
        Stage storage st = _stage(_deal(dealId), stage);
        return (st.amount, st.status, st.submittedAt, st.evidence);
    }

    function backupArbiterOf(uint256 dealId) external view returns (address) {
        return _deal(dealId).backupArbiter;
    }

    function getDeadlines(uint256 dealId) external view returns (uint64 createdAt, uint64 fundingSecs, uint64 stageSecs, uint64 disputeSecs) {
        Deal storage d = _deal(dealId);
        return (d.createdAt, d.deadlines.fundingSecs, d.deadlines.stageSecs, d.deadlines.disputeSecs);
    }

    /// @notice Неустойка: ставка и предел сделки, начисленная по этапу сумма.
    function getPenalty(uint256 dealId, uint256 stage) external view returns (uint16 bpsPerDay, uint16 capBps, uint128 penalty) {
        Deal storage d = _deal(dealId);
        return (d.penalty.bpsPerDay, d.penalty.capBps, _stage(d, stage).penalty);
    }

    function getStageTimes(uint256 dealId, uint256 stage) external view returns (uint64 activeSince, uint64 disputedAt) {
        Stage storage st = _stage(_deal(dealId), stage);
        return (st.activeSince, st.disputedAt);
    }

    function fundersOf(uint256 dealId) external view returns (address[] memory) {
        return _deal(dealId).funders;
    }

    /// @notice Сумма резервов сделки: должна совпадать с totalReserved внутри сделки.
    function reservedSum(uint256 dealId) external view returns (uint256 sum) {
        Deal storage d = _deal(dealId);
        for (uint256 i = 0; i < d.funders.length; i++) sum += reserves[dealId][d.funders[i]];
    }
}
