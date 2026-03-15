// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title WoGLandRegistry
 * @notice On-chain proof of land ownership for World of Geneva farmland plots.
 *         Server-authoritative: only the deployer (game server wallet) can
 *         claim, release, transfer, and update plots.
 *
 *         Each plot is an ERC-721 NFT minted to the owner's wallet on claim.
 *         Peer-to-peer transfers are blocked — all movements go through the server.
 *
 * @dev Built for OpenZeppelin Contracts v4.9.x (SKALE Base deployment).
 */

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract WoGLandRegistry is ERC721, Ownable {

    // ============ Structs ============

    struct PlotInfo {
        string plotId;          // e.g. "sf-plot-1"
        string zoneId;          // e.g. "sunflower-fields"
        uint16 x;
        uint16 y;
        string buildingType;    // "" if none, "cottage"/"farmhouse"/"manor"/"estate"
        uint8 buildingStage;    // 0 = empty, 1-4 = construction stages
        uint256 claimedAt;      // block.timestamp
    }

    // ============ State ============

    uint256 public nextTokenId;

    // tokenId => PlotInfo
    mapping(uint256 => PlotInfo) public plots;

    // keccak256(plotId) => tokenId (0 = never minted)
    mapping(bytes32 => uint256) public plotIdToToken;

    // wallet => tokenId (one plot per player; 0 = none)
    mapping(address => uint256) public ownerPlot;

    // ============ Events ============

    event PlotClaimed(uint256 indexed tokenId, string plotId, string zoneId, address indexed owner);
    event PlotReleased(uint256 indexed tokenId, string plotId, address indexed previousOwner);
    event PlotTransferred(uint256 indexed tokenId, address indexed from, address indexed to);
    event BuildingUpdated(uint256 indexed tokenId, string buildingType, uint8 stage);

    // ============ Constructor ============

    constructor() ERC721("WoG Land", "WOGL") {
        nextTokenId = 1; // token 0 is reserved as "no plot"
    }

    // ============ Server-only mutations ============

    /**
     * @notice Claim a plot for a player. Mints an NFT to `plotOwner`.
     */
    function claimPlot(
        string calldata plotId,
        string calldata zoneId,
        uint16 x,
        uint16 y,
        address plotOwner
    ) external onlyOwner returns (uint256 tokenId) {
        require(ownerPlot[plotOwner] == 0, "Already owns a plot");

        bytes32 plotHash = keccak256(abi.encodePacked(plotId));
        require(plotIdToToken[plotHash] == 0, "Plot already claimed");

        tokenId = nextTokenId++;
        _mint(plotOwner, tokenId);

        plots[tokenId] = PlotInfo({
            plotId: plotId,
            zoneId: zoneId,
            x: x,
            y: y,
            buildingType: "",
            buildingStage: 0,
            claimedAt: block.timestamp
        });

        plotIdToToken[plotHash] = tokenId;
        ownerPlot[plotOwner] = tokenId;

        emit PlotClaimed(tokenId, plotId, zoneId, plotOwner);
    }

    /**
     * @notice Release a player's plot. Burns the NFT and clears all state.
     */
    function releasePlot(address plotOwner) external onlyOwner {
        uint256 tokenId = ownerPlot[plotOwner];
        require(tokenId != 0, "No plot owned");

        bytes32 plotHash = keccak256(abi.encodePacked(plots[tokenId].plotId));

        emit PlotReleased(tokenId, plots[tokenId].plotId, plotOwner);

        _burn(tokenId);
        delete plotIdToToken[plotHash];
        delete ownerPlot[plotOwner];
        delete plots[tokenId];
    }

    /**
     * @notice Transfer a plot from one player to another.
     */
    function transferPlot(address from, address to) external onlyOwner {
        uint256 tokenId = ownerPlot[from];
        require(tokenId != 0, "Sender has no plot");
        require(ownerPlot[to] == 0, "Recipient already owns a plot");

        _transfer(from, to, tokenId);
        ownerPlot[from] = 0;
        ownerPlot[to] = tokenId;

        emit PlotTransferred(tokenId, from, to);
    }

    /**
     * @notice Update building state on a plot.
     */
    function updateBuilding(
        uint256 tokenId,
        string calldata buildingType,
        uint8 stage
    ) external onlyOwner {
        require(tokenId > 0 && tokenId < nextTokenId, "Invalid tokenId");
        plots[tokenId].buildingType = buildingType;
        plots[tokenId].buildingStage = stage;
        emit BuildingUpdated(tokenId, buildingType, stage);
    }

    // ============ View functions ============

    function getPlotByOwner(address plotOwner) external view returns (PlotInfo memory) {
        uint256 tokenId = ownerPlot[plotOwner];
        require(tokenId != 0, "No plot owned");
        return plots[tokenId];
    }

    function getPlotByPlotId(string calldata plotId) external view returns (PlotInfo memory, address plotOwner) {
        bytes32 plotHash = keccak256(abi.encodePacked(plotId));
        uint256 tokenId = plotIdToToken[plotHash];
        require(tokenId != 0, "Plot not claimed");
        return (plots[tokenId], ownerOf(tokenId));
    }

    // ============ Transfer restrictions ============

    /**
     * @dev Block all transfers except those initiated by the contract owner (server).
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal override {
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
        // Allow mints (from=0) and burns (to=0); block peer-to-peer
        if (from != address(0) && to != address(0)) {
            require(msg.sender == owner(), "Transfers restricted to game server");
        }
    }
}
