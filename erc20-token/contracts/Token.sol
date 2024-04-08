// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Token is ERC20, Ownable {
    address private _treasury;
    uint8 private _rate = 5;

    mapping(address account => bool) private blacklists;

    constructor(string memory name_, string memory symbol_, uint256 totalSupply_, address treasury_) ERC20(name_, symbol_) Ownable() {
        _mint(msg.sender, totalSupply_);
        _treasury = treasury_;
    }

    function getTreasury() public view returns (address) {
        return _treasury;
    }

    function setTreasury(address treasury) public onlyOwner returns (bool) {
        require(_treasury == treasury, 'Account is treasury');
        _treasury = treasury;
        return true;
    }

    function addBlacklist(address account) public onlyOwner returns (bool) {
        require(!blacklists[account], 'Account is backlisted');
        blacklists[account] = true;
        return true;
    }

    function removeBlacklist(address account) public onlyOwner returns (bool) {
        require(blacklists[account], 'Account not exist');
        blacklists[account] = false;
        return true;
    }

    function transfer(address to, uint256 value) public override virtual returns (bool) {
        address owner = _msgSender();
        require(!blacklists[_msgSender()], 'Account in backlist');
        _transfer(owner, _treasury, value * _rate / 100);
        _transfer(owner, to, value * (1 - _rate / 100));
        return true;
    }

    function transferFrom(address from, address to, uint256 value) public override virtual returns (bool) {
        address spender = _msgSender();
        require(!blacklists[_msgSender()], 'Account in backlist');
        _spendAllowance(from, spender, value);
        _transfer(from, _treasury, value * _rate / 100);
        _transfer(from, to, value * (1 - _rate / 100));
        return true;
    }
}