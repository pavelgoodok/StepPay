// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title StepAnchor
 * @notice Внешний якорь истории StepPay: публичная запись корней, которые фиксирует платформа.
 * Корень якоря (SHA-256) связывает концы журналов всех сделок, журнал операций с деньгами и предыдущий корень.
 * Раз записанный корень изменить нельзя, поэтому переписать историю задним числом незаметно не получится:
 * пересчитанный корень не совпадет с тем, что уже лежит в сети. Контракт ничего не знает о сделках и деньгах.
 */
contract StepAnchor {
    address public immutable publisher;
    uint64 public count;
    mapping(uint64 => bytes32) public roots;
    mapping(uint64 => uint64) public anchoredAt;

    event Anchored(uint64 indexed n, bytes32 root, uint64 at);

    error Unauthorized();
    error BadNumber();

    constructor(address publisher_) {
        publisher = publisher_;
    }

    /// @notice Записывает следующий по порядку корень. Номера идут без пропусков, перезаписать нельзя.
    function anchor(uint64 n, bytes32 root) external {
        if (msg.sender != publisher) revert Unauthorized();
        if (n != count + 1 || root == bytes32(0)) revert BadNumber();
        count = n;
        roots[n] = root;
        anchoredAt[n] = uint64(block.timestamp);
        emit Anchored(n, root, uint64(block.timestamp));
    }
}
