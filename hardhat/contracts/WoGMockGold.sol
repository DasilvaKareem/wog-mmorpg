// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract WoGMockGold is ERC20, Ownable {
    constructor() ERC20("WoG Gold", "GOLD") {}

    function mintTo(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
