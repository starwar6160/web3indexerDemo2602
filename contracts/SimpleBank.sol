// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title SimpleBank
 * @dev 用于测试事件索引的简单合约
 * Phase 3: 事件解析核心逻辑的测试合约
 */
contract SimpleBank {
    // 存款事件 - 用于测试事件索引
    event Deposit(
        address indexed from,
        uint256 amount,
        uint256 timestamp
    );

    // 提款事件
    event Withdrawal(
        address indexed to,
        uint256 amount,
        uint256 timestamp
    );

    // 转账事件
    event Transfer(
        address indexed from,
        address indexed to,
        uint256 amount,
        uint256 timestamp
    );

    mapping(address => uint256) public balances;
    uint256 public totalDeposits;

    /**
     * @dev 存款并触发 Deposit 事件
     */
    function deposit() external payable {
        require(msg.value > 0, "Must send ETH");
        
        balances[msg.sender] += msg.value;
        totalDeposits += msg.value;

        emit Deposit(
            msg.sender,
            msg.value,
            block.timestamp
        );
    }

    /**
     * @dev 提款并触发 Withdrawal 事件
     */
    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        
        balances[msg.sender] -= amount;
        totalDeposits -= amount;

        payable(msg.sender).transfer(amount);

        emit Withdrawal(
            msg.sender,
            amount,
            block.timestamp
        );
    }

    /**
     * @dev 转账给另一个地址
     */
    function transfer(address to, uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        require(to != address(0), "Invalid address");

        balances[msg.sender] -= amount;
        balances[to] += amount;

        emit Transfer(
            msg.sender,
            to,
            amount,
            block.timestamp
        );
    }

    /**
     * @dev 查询余额
     */
    function getBalance() external view returns (uint256) {
        return balances[msg.sender];
    }
}
