// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Тестовый токен для проверки контракта: заменяет цифровой рубль. Токены тестовой сети не имеют стоимости.
contract TestRub {
    string public constant name = "Test Digital Ruble";
    string public constant symbol = "tRUB";
    uint8 public constant decimals = 2; // копейки, как в ядре
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /// @dev только для испытаний: имитация токена с черным списком (перевод в такой адрес откатывается)
    mapping(address => bool) public blocked;
    /// @dev только для испытаний: имитация токена с комиссией при переводе (сжигается у получателя)
    uint256 public transferFeeBps;

    function setBlocked(address who, bool value) external {
        blocked[who] = value;
    }

    function setTransferFeeBps(uint256 bps) external {
        transferFeeBps = bps;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= amount, "allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) private {
        require(balanceOf[from] >= amount, "balance");
        require(!blocked[to], "blocked");
        balanceOf[from] -= amount;
        uint256 fee = (amount * transferFeeBps) / 10_000;
        balanceOf[to] += amount - fee;
        totalSupply -= fee;
        emit Transfer(from, to, amount - fee);
    }
}
