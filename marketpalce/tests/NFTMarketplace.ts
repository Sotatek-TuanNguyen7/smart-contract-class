import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { MockERC1155, MockERC20, MockERC721, NFTMarketplace } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("NFTMarketplace", function () {
  let deployer: SignerWithAddress, seller: SignerWithAddress, buyer: SignerWithAddress, bidder1: SignerWithAddress, bidder2: SignerWithAddress, treasury: SignerWithAddress;
  let marketplace: NFTMarketplace;
  let erc721: MockERC721;
  let erc1155: MockERC1155;
  let erc20: MockERC20;
  let listingERC721Id: string;
  let listingERC1155Id: string;

  beforeEach(async () => {
    [deployer, seller, buyer, bidder1, bidder2, treasury] = await ethers.getSigners();
    const contractMarketplace: any = await ethers.getContractFactory("NFTMarketplace");
    const mockERC721 = await ethers.getContractFactory("MockERC721");
    const mockERC1155 = await ethers.getContractFactory("MockERC1155");
    const mockERC20 = await ethers.getContractFactory("MockERC20");

    erc721 = await mockERC721.deploy("Mock721", "M721");
    erc1155 = await mockERC1155.deploy("Mock1155");
    erc20 = await mockERC20.deploy("Mock20", "M20", 18);
    marketplace = await upgrades.deployProxy(contractMarketplace, [deployer.address, 25, 25], { initializer: "initialize" });

    // Mint tokens
    await erc721.mint(seller.address, 1);
    await erc1155.mint(seller.address, 1, 10, "0x");
    await erc20.mint(buyer.address, ethers.parseEther("100"));
    await erc20.mint(bidder1.address, ethers.parseEther("100"));
    await erc20.mint(bidder2.address, ethers.parseEther("100"));

    listingERC721Id = ethers.solidityPackedKeccak256(
      ["address", "uint256", "address"],
      [erc721.target, 1, seller.address]
    );

    listingERC1155Id = ethers.solidityPackedKeccak256(
      ["address", "uint256", "address"],
      [erc1155.target, 1, seller.address]
    );
  });

  describe("Initialization", function () {
    it("Should set the correct treasury and fee percentages", async function () {
      expect(await marketplace.treasury()).to.equal(deployer.address);
      expect(await marketplace.BUYER_FEE_PERCENTAGE()).to.equal(25);
      expect(await marketplace.SELLER_FEE_PERCENTAGE()).to.equal(25);
    });
  });

  describe("Listing NFTs", function () {
    it("should allow a user to list an ERC721 NFT for fixed price", async () => {
      await erc721.connect(seller).approve(marketplace.target, 1);
      await expect(marketplace.connect(seller).listNFT(erc721.target, 1, ethers.parseEther("1"), ethers.ZeroAddress, false, 0))
        .to.emit(marketplace, 'Listed')
        .withArgs(listingERC721Id, seller.address, erc721.target, 1, ethers.parseEther("1"), ethers.ZeroAddress, false, 0);
    });

    it("should allow a user to list an ERC1155 NFT for auction", async () => {
      const duration = 86400;
      await erc1155.connect(seller).setApprovalForAll(marketplace.target, true);
      await expect(marketplace.connect(seller).listNFT(erc1155.target, 1, ethers.parseEther("1"), ethers.ZeroAddress, true, duration))
        .to.emit(marketplace, 'Listed');
    });

    it("should revert if price is 0", async () => {
      await erc721.connect(seller).approve(marketplace.target, 1);
      await expect(marketplace.connect(seller).listNFT(erc721.target, 1, 0, ethers.ZeroAddress, false, 0))
        .to.be.revertedWith("Price must be greater than 0");
    });

    it("should revert if user is blacklisted", async () => {
      await marketplace.connect(deployer).blacklistUser(seller.address);
      await erc721.connect(seller).approve(marketplace.target, 1);
      await expect(marketplace.connect(seller).listNFT(erc721.target, 1, ethers.parseEther("1"), ethers.ZeroAddress, false, 0))
        .to.be.revertedWith("User is blacklisted");
    });

    it("should revert if NFT is already listed", async () => {
      await erc721.connect(seller).approve(marketplace.target, 1);
      await marketplace.connect(seller).listNFT(erc721.target, 1, ethers.parseEther("1"), ethers.ZeroAddress, false, 0);
      await expect(marketplace.connect(seller).listNFT(erc721.target, 1, ethers.parseEther("1"), ethers.ZeroAddress, false, 0))
        .to.be.revertedWith("Already listed");
    });
  });

  describe("Buying NFTs", function () {
    beforeEach(async () => {
      await erc721.connect(seller).approve(marketplace.target, 1);
      await marketplace.connect(seller).listNFT(erc721.target, 1, ethers.parseEther("1"), ethers.ZeroAddress, false, 0);

      listingERC721Id = ethers.solidityPackedKeccak256(
        ["address", "uint256", "address"],
        [erc721.target, 1, seller.address]
      );
    });

    it("should allow a user to buy a listed NFT", async () => {
      await expect(marketplace.connect(buyer).buyNFT(listingERC721Id, { value: ethers.parseEther("1.0025") }))
        .to.emit(marketplace, 'Bought')
        .withArgs(listingERC721Id, buyer.address);
    });

    it("should revert if user does not send enough ETH", async () => {
      await expect(marketplace.connect(buyer).buyNFT(listingERC721Id, { value: ethers.parseEther("1") }))
        .to.be.revertedWith("Incorrect payment amount");
    });

    it("should revert if user is blacklisted", async () => {
      await marketplace.connect(deployer).blacklistUser(buyer.address);
      await expect(marketplace.connect(buyer).buyNFT(listingERC721Id, { value: ethers.parseEther("1.0025") }))
        .to.be.revertedWith("User is blacklisted");
    });

    it("should revert if trying to buy an auctioned NFT", async () => {
      await erc1155.connect(seller).setApprovalForAll(marketplace.target, true);
      await marketplace.connect(seller).listNFT(erc1155.target, 1, ethers.parseEther("1"), ethers.ZeroAddress, true, 86400);
      await expect(marketplace.connect(buyer).buyNFT(listingERC1155Id, { value: ethers.parseEther("1.0025") }))
        .to.be.revertedWith("Cannot buy an auctioned NFT");
    });

    it("should revert if trying to buy a non-existent NFT", async () => {
      const nonExistentListingId = ethers.solidityPackedKeccak256(
        ["address", "uint256", "address"],
        [erc721.target, 999, seller.address]
      );
      await expect(marketplace.connect(buyer).buyNFT(nonExistentListingId, { value: ethers.parseEther("1.0025") }))
        .to.be.revertedWith("Listing does not exist");
    });
  });

  describe("Auctioning NFTs", function () {
    beforeEach(async () => {
      await erc1155.connect(seller).setApprovalForAll(marketplace.target, true);
      await marketplace.connect(seller).listNFT(erc1155.target, 1, ethers.parseEther("1"), ethers.ZeroAddress, true, 86400);
    });

    it("should allow users to place bids", async () => {
      await expect(marketplace.connect(bidder1).placeBid(listingERC1155Id, { value: ethers.parseEther("1") }))
        .to.emit(marketplace, 'BidPlaced')
        .withArgs(listingERC1155Id, bidder1.address, ethers.parseEther("1"));
    });

    it("should revert if bid is too low", async () => {
      await marketplace.connect(bidder1).placeBid(listingERC1155Id, { value: ethers.parseEther("1") });
      await expect(marketplace.connect(bidder2).placeBid(listingERC1155Id, { value: ethers.parseEther("1.000000000000000001") }))
        .to.be.revertedWith("Bid too low");
    });

    it("should refund previous highest bidder when outbid", async () => {
      await marketplace.connect(bidder1).placeBid(listingERC1155Id, { value: ethers.parseEther("1") });
      await expect(marketplace.connect(bidder2).placeBid(listingERC1155Id, { value: ethers.parseEther("2") }))
        .to.changeEtherBalance(bidder1, ethers.parseEther("1"));
  
      const marketplaceBalance = await ethers.provider.getBalance(marketplace.target);
      expect(marketplaceBalance).to.equal(ethers.parseEther("2"));
    });

    it("should allow highest bidder to claim NFT after auction ends", async () => {
      await marketplace.connect(bidder1).placeBid(listingERC1155Id, { value: ethers.parseEther("1") });
      await ethers.provider.send("evm_increaseTime", [86400]); // fast forward time
      await ethers.provider.send("evm_mine");
      await expect(marketplace.connect(bidder1).claimNFT(listingERC1155Id))
        .to.emit(marketplace, 'Claimed')
        .withArgs(listingERC1155Id, bidder1.address);
    });

    it("should allow seller to claim funds after auction ends", async () => {
      await marketplace.connect(bidder1).placeBid(listingERC1155Id, { value: ethers.parseEther("1") });
      await ethers.provider.send("evm_increaseTime", [86400]); // fast forward time
      await ethers.provider.send("evm_mine");
      await expect(() => marketplace.connect(seller).claimNFT(listingERC1155Id))
        .to.changeEtherBalance(seller, ethers.parseEther("0.9975")); // seller receives amount minus fees
    });

    it("should revert if non-winner tries to claim NFT", async () => {
      await marketplace.connect(bidder1).placeBid(listingERC1155Id, { value: ethers.parseEther("1") });
      await ethers.provider.send("evm_increaseTime", [86400]); // fast forward time
      await ethers.provider.send("evm_mine");
      await expect(marketplace.connect(bidder2).claimNFT(listingERC1155Id))
        .to.be.revertedWith("Unauthorized claim");
    });

    it("should revert if trying to place a bid on a non-existent NFT", async () => {
      const nonExistentListingId = ethers.solidityPackedKeccak256(
        ["address", "uint256", "address"],
        [erc1155.target, 999, seller.address]
      );
      await expect(marketplace.connect(bidder1).placeBid(nonExistentListingId, { value: ethers.parseEther("1") }))
        .to.be.revertedWith("Listing does not exist");
    });

    it("should revert if trying to place a bid after auction ended", async () => {
      await marketplace.connect(bidder1).placeBid(listingERC1155Id, { value: ethers.parseEther("1") });
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine");
      await expect(marketplace.connect(bidder2).placeBid(listingERC1155Id, { value: ethers.parseEther("2") }))
        .to.be.revertedWith("Auction ended");
    });

    it("should revert if trying to claim before auction ends", async () => {
      await marketplace.connect(bidder1).placeBid(listingERC1155Id, { value: ethers.parseEther("1") });
      await expect(marketplace.connect(bidder1).claimNFT(listingERC1155Id))
        .to.be.revertedWith("Auction not ended");
    });

    it("should revert if trying to claim a non-existent NFT", async () => {
      const nonExistentListingId = ethers.solidityPackedKeccak256(
        ["address", "uint256", "address"],
        [erc1155.target, 999, seller.address]
      );
      await expect(marketplace.connect(bidder1).claimNFT(nonExistentListingId))
        .to.be.revertedWith("Listing does not exist");
    });
  });

  describe("Cancelling Listings", function () {
    it("should allow seller to cancel a fixed price listing", async () => {
      await erc721.connect(seller).approve(marketplace.target, 1);
      await marketplace.connect(seller).listNFT(erc721.target, 1, ethers.parseEther("1"), ethers.ZeroAddress, false, 0);
      await expect(marketplace.connect(seller).cancelListing(listingERC721Id))
        .to.emit(marketplace, 'ListingCancelled')
        .withArgs(listingERC721Id);
    });

    it("should revert if non-seller tries to cancel a listing", async () => {
      await erc721.connect(seller).approve(marketplace.target, 1);
      await marketplace.connect(seller).listNFT(erc721.target, 1, ethers.parseEther("1"), ethers.ZeroAddress, false, 0);
      await expect(marketplace.connect(buyer).cancelListing(listingERC721Id))
        .to.be.revertedWith("Not the seller");
    });

    it("should allow seller to cancel an auction before any bids are placed", async () => {
      await erc1155.connect(seller).setApprovalForAll(marketplace.target, true);
      await marketplace.connect(seller).listNFT(erc1155.target, 1, ethers.parseEther("1"), ethers.ZeroAddress, true, 86400);
      await expect(marketplace.connect(seller).cancelListing(listingERC1155Id))
        .to.emit(marketplace, 'ListingCancelled')
        .withArgs(listingERC1155Id);
    });

    it("should revert if seller tries to cancel an auction after bids are placed", async () => {
      await erc1155.connect(seller).setApprovalForAll(marketplace.target, true);
      await marketplace.connect(seller).listNFT(erc1155.target, 1, ethers.parseEther("1"), ethers.ZeroAddress, true, 86400);
      await marketplace.connect(bidder1).placeBid(listingERC1155Id, { value: ethers.parseEther("1") });
      await expect(marketplace.connect(seller).cancelListing(listingERC1155Id))
        .to.be.revertedWith("Cannot cancel with bids");
    });

    it("should revert if trying to cancel a non-existent listing", async () => {
      const nonExistentListingId = ethers.solidityPackedKeccak256(
        ["address", "uint256", "address"],
        [erc721.target, 999, seller.address]
      );
      await expect(marketplace.connect(seller).cancelListing(nonExistentListingId))
        .to.be.revertedWith("Listing does not exist");
    });

    it("should revert if trying to cancel after auction ended", async () => {
      await erc1155.connect(seller).setApprovalForAll(marketplace.target, true);
      await marketplace.connect(seller).listNFT(erc1155.target, 1, ethers.parseEther("1"), ethers.ZeroAddress, true, 86400);
      await marketplace.connect(bidder1).placeBid(listingERC1155Id, { value: ethers.parseEther("1") });
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine");
      await expect(marketplace.connect(seller).cancelListing(listingERC1155Id))
        .to.be.revertedWith("Auction ended");
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

    it("should update treasury", async () => {
      await marketplace.connect(deployer).setTreasury(treasury.address);
      expect(await marketplace.treasury()).to.equal(treasury.address);
    });

    it("should revert if fee exceeds 100%", async () => {
      await expect(marketplace.connect(deployer).setBuyerFeePercentage(10001))
        .to.be.revertedWith("Fee cannot exceed 100%");
      await expect(marketplace.connect(deployer).setSellerFeePercentage(10001))
        .to.be.revertedWith("Fee cannot exceed 100%");
    });

    it("should revert if same treasury", async () => {
      await expect(marketplace.connect(deployer).setTreasury(deployer.address))
        .to.be.revertedWith("Account is treasury");
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
