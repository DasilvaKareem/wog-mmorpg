// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

contract WoGMockItems is ERC1155, Ownable {
    uint256 public nextTokenIdToMint;

    mapping(uint256 => string) private tokenUris;

    constructor() ERC1155("") {}

    function mintTo(
        address to,
        uint256 tokenId,
        string calldata tokenUri,
        uint256 amount
    ) external onlyOwner {
        uint256 resolvedTokenId = tokenId;

        if (resolvedTokenId == type(uint256).max) {
            resolvedTokenId = nextTokenIdToMint;
            nextTokenIdToMint += 1;
            require(bytes(tokenUri).length > 0, "URI required for new token");
            tokenUris[resolvedTokenId] = tokenUri;
        } else {
            require(resolvedTokenId < nextTokenIdToMint, "Token does not exist");
            if (bytes(tokenUri).length > 0) {
                tokenUris[resolvedTokenId] = tokenUri;
            }
        }

        _mint(to, resolvedTokenId, amount, "");
    }

    function burn(address account, uint256 id, uint256 value) external {
        require(
            account == _msgSender() || isApprovedForAll(account, _msgSender()),
            "ERC1155: caller is not token owner or approved"
        );
        _burn(account, id, value);
    }

    function uri(uint256 tokenId) public view override returns (string memory) {
        return tokenUris[tokenId];
    }
}
