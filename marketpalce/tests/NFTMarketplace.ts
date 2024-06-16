import { expect } from "chai";
import { ethers } from "hardhat";
import { MockERC20, SwapToken } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("NFTMarketplace", function () {
  let deployer, seller, buyer, bidder1, bidder2;
  let NFTMarketplace, marketplace;
  let ERC721Mock, erc721;
  let ERC1155Mock, erc1155;
  let ERC20Mock, erc20;
  let listingId;

  before(async () => {
    [deployer, seller, buyer, bidder1, bidder2] = await ethers.getSigners();
    NFTMarketplace = await ethers.getContractFactory("NFTMarketplace");
    ERC721Mock = await ethers.getContractFactory("ERC721Mock");
    ERC1155Mock = await ethers.getContractFactory("ERC1155Mock");
    ERC20Mock = await ethers.getContractFactory("ERC20Mock");

    erc721 = await ERC721Mock.deploy("Mock721", "M721");
    await erc721.deployed();
    erc1155 = await ERC1155Mock.deploy("Mock1155");
    await erc1155.deployed();
    erc20 = await ERC20Mock.deploy("Mock20", "M20", 18);
    await erc20.deployed();

    marketplace = await upgrades.deployProxy(NFTMarketplace, [deployer.address, 25, 25], { initializer: "initialize" });
    await marketplace.deployed();
  });

  beforeEach(async () => {
    // Mint tokens
    await erc721.mint(seller.address, 1);
    await erc1155.mint(seller.address, 1, 10);
    await erc20.mint(buyer.address, ethers.utils.parseEther("100"));
    await erc20.mint(bidder1.address, ethers.utils.parseEther("100"));
    await erc20.mint(bidder2.address, ethers.utils.parseEther("100"));

    listingId = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(
      ["address", "uint256", "address"],
      [erc721.address, 1, seller.address]
    ));
  });

  describe("Listing NFTs", function () {
    it("should allow a user to list an ERC721 NFT for fixed price", async () => {
      await erc721.connect(seller).approve(marketplace.address, 1);
      await expect(marketplace.connect(seller).listNFT(erc721.address, 1, ethers.utils.parseEther("1"), ethers.constants.AddressZero, false, 0))
        .to.emit(marketplace, 'Listed')
        .withArgs(listingId, seller.address, erc721.address, 1, ethers.utils.parseEther("1"), ethers.constants.AddressZero, false, 0);
    });

    it("should allow a user to list an ERC1155 NFT for auction", async () => {
      await erc1155.connect(seller).setApprovalForAll(marketplace.address, true);
      await expect(marketplace.connect(seller).listNFT(erc1155.address, 1, ethers.utils.parseEther("1"), ethers.constants.AddressZero, true, 86400))
        .to.emit(marketplace, 'Listed')
        .withArgs(listingId, seller.address, erc1155.address, 1, ethers.utils.parseEther("1"), ethers.constants.AddressZero, true, await ethers.provider.getBlockNumber() + 86400);
    });

    it("should revert if price is 0", async () => {
      await erc721.connect(seller).approve(marketplace.address, 1);
      await expect(marketplace.connect(seller).listNFT(erc721.address, 1, 0, ethers.constants.AddressZero, false, 0))
        .to.be.revertedWith("Price must be greater than 0");
    });

    it("should revert if user is blacklisted", async () => {
      await marketplace.connect(deployer).blacklistUser(seller.address);
      await erc721.connect(seller).approve(marketplace.address, 1);
      await expect(marketplace.connect(seller).listNFT(erc721.address, 1, ethers.utils.parseEther("1"), ethers.constants.AddressZero, false, 0))
        .to.be.revertedWith("User is blacklisted");
    });
  });

  describe("Buying NFTs", function () {
    beforeEach(async () => {
      await erc721.connect(seller).approve(marketplace.address, 1);
      await marketplace.connect(seller).listNFT(erc721.address, 1, ethers.utils.parseEther("1"), ethers.constants.AddressZero, false, 0);
    });

    it("should allow a user to buy a listed NFT", async () => {
      await expect(marketplace.connect(buyer).buyNFT(listingId, { value: ethers.utils.parseEther("1.00025") }))
        .to.emit(marketplace, 'Bought')
        .withArgs(listingId, buyer.address);
    });

    it("should revert if user does not send enough ETH", async () => {
      await expect(marketplace.connect(buyer).buyNFT(listingId, { value: ethers.utils.parseEther("1") }))
        .to.be.revertedWith("Incorrect payment amount");
    });

    it("should revert if user is blacklisted", async () => {
      await marketplace.connect(deployer).blacklistUser(buyer.address);
      await expect(marketplace.connect(buyer).buyNFT(listingId, { value: ethers.utils.parseEther("1.00025") }))
        .to.be.revertedWith("User is blacklisted");
    });

    it("should revert if trying to buy an auctioned NFT", async () => {
      await erc1155.connect(seller).setApprovalForAll(marketplace.address, true);
      await marketplace.connect(seller).listNFT(erc1155.address, 1, ethers.utils.parseEther("1"), ethers.constants.AddressZero, true, 86400);
      await expect(marketplace.connect(buyer).buyNFT(listingId, { value: ethers.utils.parseEther("1.00025") }))
        .to.be.revertedWith("Cannot buy an auctioned NFT");
    });
  });

  describe("Auctioning NFTs", function () {
    beforeEach(async () => {
      await erc1155.connect(seller).setApprovalForAll(marketplace.address, true);
      await marketplace.connect(seller).listNFT(erc1155.address, 1, ethers.utils.parseEther("1"), ethers.constants.AddressZero, true, 86400);
    });

    it("should allow users to place bids", async () => {
      await expect(marketplace.connect(bidder1).placeBid(listingId, { value: ethers.utils.parseEther("1") }))
        .to.emit(marketplace, 'BidPlaced')
        .withArgs(listingId, bidder1.address, ethers.utils.parseEther("1"));
    });

    it("should revert if bid is too low", async () => {
      await marketplace.connect(bidder1).placeBid(listingId, { value: ethers.utils.parseEther("1") });
      await expect(marketplace.connect(bidder2).placeBid(listingId, { value: ethers.utils.parseEther("1.000000000000000001") }))
        .to.be.revertedWith("Bid too low");
    });

    it("should refund previous highest bidder when outbid", async () => {
      await marketplace.connect(bidder1).placeBid(listingId, { value: ethers.utils.parseEther("1") });
      await expect(() => marketplace.connect(bidder2).placeBid(listingId, { value: ethers.utils.parseEther("2") }))
        .to.changeEtherBalances([marketplace, bidder1], [ethers.utils.parseEther("2"), ethers.utils.parseEther("1")]);
    });

    it("should allow highest bidder to claim NFT after auction ends", async () => {
      await marketplace.connect(bidder1).placeBid(listingId, { value: ethers.utils.parseEther("1") });
      await ethers.provider.send("evm_increaseTime", [86400]); // fast forward time
      await ethers.provider.send("evm_mine");
      await expect(marketplace.connect(bidder1).claimNFT(listingId))
        .to.emit(marketplace, 'Claimed')
        .withArgs(listingId, bidder1.address);
    });

    it("should allow seller to claim funds after auction ends", async () => {
      await marketplace.connect(bidder1).placeBid(listingId, { value: ethers.utils.parseEther("1") });
      await ethers.provider.send("evm_increaseTime", [86400]); // fast forward time
      await ethers.provider.send("evm_mine");
      await expect(() => marketplace.connect(seller).claimNFT(listingId))
        .to.changeEtherBalance(seller, ethers.utils.parseEther("0.99975")); // seller receives amount minus fees
    });

    it("should revert if non-winner tries to claim NFT", async () => {
      await marketplace.connect(bidder1).placeBid(listingId, { value: ethers.utils.parseEther("1") });
      await ethers.provider.send("evm_increaseTime", [86400]); // fast forward time
      await ethers.provider.send("evm_mine");
      await expect(marketplace.connect(bidder2).claimNFT(listingId))
        .to.be.revertedWith("Unauthorized claim");
    });
  });

  describe("Cancelling Listings", function () {
    it("should allow seller to cancel a fixed price listing", async () => {
      await erc721.connect(seller).approve(marketplace.address, 1);
      await marketplace.connect(seller).listNFT(erc721.address, 1, ethers.utils.parseEther("1"), ethers.constants.AddressZero, false, 0);
      await expect(marketplace.connect(seller).cancelListing(listingId))
        .to.emit(marketplace, 'ListingCancelled')
        .withArgs(listingId);
    });

    it("should revert if non-seller tries to cancel a listing", async () => {
      await erc721.connect(seller).approve(marketplace.address, 1);
      await marketplace.connect(seller).listNFT(erc721.address, 1, ethers.utils.parseEther("1"), ethers.constants.AddressZero, false, 0);
      await expect(marketplace.connect(buyer).cancelListing(listingId))
        .to.be.revertedWith("Not the seller");
    });

    it("should allow seller to cancel an auction before any bids are placed", async () => {
      await erc1155.connect(seller).setApprovalForAll(marketplace.address, true);
      await marketplace.connect(seller).listNFT(erc1155.address, 1, ethers.utils.parseEther("1"), ethers.constants.AddressZero, true, 86400);
      await expect(marketplace.connect(seller).cancelListing(listingId))
        .to.emit(marketplace, 'ListingCancelled')
        .withArgs(listingId);
    });

    it("should revert if seller tries to cancel an auction after bids are placed", async () => {
      await erc1155.connect(seller).setApprovalForAll(marketplace.address, true);
      await marketplace.connect(seller).listNFT(erc1155.address, 1, ethers.utils.parseEther("1"), ethers.constants.AddressZero, true, 86400);
      await marketplace.connect(bidder1).placeBid(listingId, { value: ethers.utils.parseEther("1") });
      await expect(marketplace.connect(seller).cancelListing(listingId))
        .to.be.revertedWith("Cannot cancel with bids");
    });
  });

  describe("Fees and Treasury", function () {
    it("should update buyer fee percentage", async () => {
      await expect(marketplace.connect(deployer).setBuyerFeePercentage(50))
        .to.emit(marketplace, 'BuyerFeePercentageUpdated')
        .withArgs(50);
    });

    it("should update seller fee percentage", async () => {
      await expect(marketplace.connect(deployer).setSellerFeePercentage(50))
        .to.emit(marketplace, 'SellerFeePercentageUpdated')
        .withArgs(50);
    });

    it("should revert if fee exceeds 100%", async () => {
      await expect(marketplace.connect(deployer).setBuyerFeePercentage(10001))
        .to.be.revertedWith("Fee cannot exceed 100%");
      await expect(marketplace.connect(deployer).setSellerFeePercentage(10001))
        .to.be.revertedWith("Fee cannot exceed 100%");
    });
  });

  describe("Blacklist", function () {
    it("should add a user to the blacklist", async () => {
      await expect(marketplace.connect(deployer).blacklistUser(buyer.address))
        .to.emit(marketplace, 'UserBlacklisted')
        .withArgs(buyer.address);
      expect(await marketplace.blacklist(buyer.address)).to.be.true;
    });

    it("should remove a user from the blacklist", async () => {
      await marketplace.connect(deployer).blacklistUser(buyer.address);
      await expect(marketplace.connect(deployer).removeUserFromBlacklist(buyer.address))
        .to.emit(marketplace, 'UserRemovedFromBlacklist')
        .withArgs(buyer.address);
      expect(await marketplace.blacklist(buyer.address)).to.be.false;
    });
  });
});
