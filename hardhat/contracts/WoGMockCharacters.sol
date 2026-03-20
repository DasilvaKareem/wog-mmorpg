// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";

contract WoGMockCharacters is ERC721Enumerable, Ownable {
    uint256 public nextTokenIdToMint;

    mapping(uint256 => string) private tokenUris;

    constructor() ERC721("WoG Characters", "WOGC") {}

    function mintTo(address to, string calldata tokenUri) external onlyOwner returns (uint256) {
        uint256 tokenId = nextTokenIdToMint;
        nextTokenIdToMint += 1;
        _safeMint(to, tokenId);
        tokenUris[tokenId] = tokenUri;
        return tokenId;
    }

    function setTokenURI(uint256 tokenId, string calldata tokenUri) external onlyOwner {
        ownerOf(tokenId);
        tokenUris[tokenId] = tokenUri;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        ownerOf(tokenId);
        return tokenUris[tokenId];
    }
}
