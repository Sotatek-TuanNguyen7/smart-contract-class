// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";

contract NFTMarketplace is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    IERC721Receiver,
    IERC1155Receiver
{
    using SafeMath for uint256;
    using Address for address payable;
    using SafeERC20 for IERC20;

    struct Listing {
        address seller;
        address nftContract;
        uint256 tokenId;
        uint256 price;
        address paymentToken;
        bool isAuction;
        uint256 auctionEndTime;
        uint256 highestBid;
        address highestBidder;
        bool claimed;
    }

    uint256 public BUYER_FEE_PERCENTAGE;
    uint256 public SELLER_FEE_PERCENTAGE;
    uint256 public constant AUCTION_MIN_STEP = 10; // Minimal bid step in wei/tokens

    address public treasury;
    mapping(address => bool) public blacklist;
    mapping(bytes32 => Listing) public listings;

    event Listed(
        bytes32 indexed listingId,
        address indexed seller,
        address indexed nftContract,
        uint256 tokenId,
        uint256 price,
        address paymentToken,
        bool isAuction,
        uint256 auctionEndTime
    );
    event Bought(bytes32 indexed listingId, address indexed buyer);
    event BidPlaced(bytes32 indexed listingId, address indexed bidder, uint256 amount);
    event Claimed(bytes32 indexed listingId, address indexed claimer);
    event ListingCancelled(bytes32 indexed listingId);
    event UserBlacklisted(address indexed user);
    event UserRemovedFromBlacklist(address indexed user);
    event BuyerFeePercentageUpdated(uint256 newFee);
    event SellerFeePercentageUpdated(uint256 newFee);

    modifier notBlacklisted() {
        require(!blacklist[msg.sender], "User is blacklisted");
        _;
    }

    modifier listingExists(bytes32 listingId) {
        require(listings[listingId].seller != address(0), "Listing does not exist");
        _;
    }

    modifier isAuction(bytes32 listingId) {
        require(listings[listingId].isAuction, "Not an auction");
        _;
    }

    modifier notAuction(bytes32 listingId) {
        require(!listings[listingId].isAuction, "Cannot buy an auctioned NFT");
        _;
    }

    modifier notClaimed(bytes32 listingId) {
        require(!listings[listingId].claimed, "Already claimed");
        _;
    }

    modifier validFee(uint256 fee) {
        require(fee <= 10000, "Fee cannot exceed 100%");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _treasury,
        uint256 _buyerFeePercentage,
        uint256 _sellerFeePercentage
    ) public initializer {
        require(_buyerFeePercentage <= 10000, "Buyer fee cannot exceed 100%");
        require(_sellerFeePercentage <= 10000, "Seller fee cannot exceed 100%");

        __Ownable_init(_msgSender());
        __ReentrancyGuard_init();

        treasury = _treasury;
        BUYER_FEE_PERCENTAGE = _buyerFeePercentage;
        SELLER_FEE_PERCENTAGE = _sellerFeePercentage;
    }

    function setBuyerFeePercentage(uint256 _buyerFeePercentage) external onlyOwner validFee(_buyerFeePercentage) {
        BUYER_FEE_PERCENTAGE = _buyerFeePercentage;
        emit BuyerFeePercentageUpdated(_buyerFeePercentage);
    }

    function setSellerFeePercentage(uint256 _sellerFeePercentage) external onlyOwner validFee(_sellerFeePercentage) {
        SELLER_FEE_PERCENTAGE = _sellerFeePercentage;
        emit SellerFeePercentageUpdated(_sellerFeePercentage);
    }

    function setTreasury(address _treasury) public onlyOwner returns (bool) {
        require(treasury != _treasury, "Account is treasury");
        treasury = _treasury;
        return true;
    }

    function listNFT(
        address nftContract,
        uint256 tokenId,
        uint256 price,
        address paymentToken,
        bool isAuction,
        uint256 auctionDuration
    ) external notBlacklisted nonReentrant {
        require(price > 0, "Price must be greater than 0");

        bytes32 listingId = keccak256(abi.encodePacked(nftContract, tokenId, msg.sender));
        require(listings[listingId].seller == address(0), "Already listed");

        listings[listingId] = Listing({
            seller: msg.sender,
            nftContract: nftContract,
            tokenId: tokenId,
            price: price,
            paymentToken: paymentToken,
            isAuction: isAuction,
            auctionEndTime: isAuction ? block.timestamp + auctionDuration : 0,
            highestBid: 0,
            highestBidder: address(0),
            claimed: false
        });

        // Transfer NFT to contract
        _transferNFT(nftContract, msg.sender, address(this), tokenId);

        emit Listed(
            listingId,
            msg.sender,
            nftContract,
            tokenId,
            price,
            paymentToken,
            isAuction,
            listings[listingId].auctionEndTime
        );
    }

    function buyNFT(
        bytes32 listingId
    ) external payable notBlacklisted listingExists(listingId) notAuction(listingId) nonReentrant {
        Listing storage listing = listings[listingId];

        uint256 totalPrice = listing.price.add(listing.price.mul(BUYER_FEE_PERCENTAGE).div(10000));
        if (listing.paymentToken == address(0)) {
            require(msg.value == totalPrice, "Incorrect payment amount");
        } else {
            IERC20(listing.paymentToken).safeTransferFrom(msg.sender, address(this), totalPrice);
        }

        _transferNFT(listing.nftContract, address(this), msg.sender, listing.tokenId);
        _distributeFunds(listing.seller, listing.price, listing.paymentToken);

        delete listings[listingId];

        emit Bought(listingId, msg.sender);
    }

    function placeBid(
        bytes32 listingId
    ) external payable notBlacklisted listingExists(listingId) isAuction(listingId) nonReentrant {
        Listing storage listing = listings[listingId];
        require(block.timestamp < listing.auctionEndTime, "Auction ended");
        require(msg.value >= listing.highestBid.add(AUCTION_MIN_STEP), "Bid too low");

        if (listing.highestBidder != address(0)) {
            (bool success, ) = listing.highestBidder.call{ value: listing.highestBid }("");
            require(success, "Refund failed");
        }

        listing.highestBid = msg.value;
        listing.highestBidder = msg.sender;

        emit BidPlaced(listingId, msg.sender, msg.value);
    }

    function claimNFT(
        bytes32 listingId
    ) external notBlacklisted listingExists(listingId) isAuction(listingId) notClaimed(listingId) nonReentrant {
        Listing storage listing = listings[listingId];
        require(block.timestamp >= listing.auctionEndTime, "Auction not ended");

        uint256 highestBid = listing.highestBid;
        uint256 fee = highestBid.mul(SELLER_FEE_PERCENTAGE).div(10000);
        uint256 sellerProceeds = highestBid.sub(fee);

        if (msg.sender == listing.seller) {
            require(highestBid >= listing.price, "Reserve price not met");
            require(address(this).balance >= highestBid, "Insufficient contract balance to transfer funds");

            _transferNFT(listing.nftContract, address(this), listing.highestBidder, listing.tokenId);
            (bool success, ) = listing.seller.call{ value: sellerProceeds }("");
            require(success, "Transfer to seller failed");
            (success, ) = treasury.call{ value: fee }("");
            require(success, "Transfer fee to treasury failed");
        } else if (msg.sender == listing.highestBidder) {
            require(address(this).balance >= highestBid, "Insufficient contract balance to transfer NFT");
            _transferNFT(listing.nftContract, address(this), listing.highestBidder, listing.tokenId);
        } else {
            revert("Unauthorized claim");
        }

        listing.claimed = true;
        emit Claimed(listingId, msg.sender);
    }

    function cancelListing(
        bytes32 listingId
    ) external notBlacklisted listingExists(listingId) notClaimed(listingId) nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.seller == msg.sender, "Not the seller");

        if (listing.isAuction) {
            require(block.timestamp < listing.auctionEndTime, "Auction ended");
            require(listing.highestBidder == address(0), "Cannot cancel with bids");
        }

        _transferNFT(listing.nftContract, address(this), listing.seller, listing.tokenId);
        delete listings[listingId];

        emit ListingCancelled(listingId);
    }

    function blacklistUser(address user) external onlyOwner {
        require(!blacklist[user], "Account is backlisted");
        blacklist[user] = true;
        emit UserBlacklisted(user);
    }

    function removeUserFromBlacklist(address user) external onlyOwner {
        require(blacklist[user], "Account not exist");
        blacklist[user] = false;
        emit UserRemovedFromBlacklist(user);
    }

    function _transferNFT(address nftContract, address from, address to, uint256 tokenId) internal {
        if (IERC721(nftContract).supportsInterface(type(IERC721).interfaceId)) {
            IERC721(nftContract).safeTransferFrom(from, to, tokenId);
        } else if (IERC1155(nftContract).supportsInterface(type(IERC1155).interfaceId)) {
            IERC1155(nftContract).safeTransferFrom(from, to, tokenId, 1, "");
        } else {
            revert("Unsupported NFT standard");
        }
    }

    function _distributeFunds(address seller, uint256 price, address paymentToken) internal {
        uint256 buyerFee = price.mul(BUYER_FEE_PERCENTAGE).div(10000);
        uint256 sellerFee = price.mul(SELLER_FEE_PERCENTAGE).div(10000);
        uint256 sellerProceeds = price.sub(sellerFee);

        if (paymentToken == address(0)) {
            uint256 totalFee = buyerFee.add(sellerFee);
            require(address(this).balance >= totalFee.add(sellerProceeds), "Insufficient contract balance");

            payable(treasury).sendValue(totalFee);
            payable(seller).sendValue(sellerProceeds);
        } else {
            uint256 totalFee = buyerFee.add(sellerFee);
            uint256 contractTokenBalance = IERC20(paymentToken).balanceOf(address(this));
            require(contractTokenBalance >= totalFee.add(sellerProceeds), "Insufficient contract token balance");

            IERC20(paymentToken).safeTransfer(treasury, totalFee);
            IERC20(paymentToken).safeTransfer(seller, sellerProceeds);
        }
    }

    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external override returns (bytes4) {
        return this.onERC721Received.selector;
    }

    function onERC1155Received(
        address operator,
        address from,
        uint256 id,
        uint256 value,
        bytes calldata data
    ) external override returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address operator,
        address from,
        uint256[] calldata ids,
        uint256[] calldata values,
        bytes calldata data
    ) external override returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC721Receiver).interfaceId || interfaceId == type(IERC1155Receiver).interfaceId;
    }

    receive() external payable {}
}
