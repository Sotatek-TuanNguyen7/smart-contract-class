import { expect } from "chai";
import { ethers } from "hardhat";
import { MockERC20, SwapToken } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("SwapToken", function () {
    let swapToken: SwapToken;
    let tokenA: MockERC20, tokenB: MockERC20;
    let owner: SignerWithAddress, acc1: SignerWithAddress, acc2: SignerWithAddress, treasury: SignerWithAddress;

    beforeEach(async function () {
        [owner, acc1, acc2, treasury] = await ethers.getSigners();

        const Token = await ethers.getContractFactory("MockERC20");
        tokenA = await Token.deploy("Token A", "TA", 10000000);
        tokenB = await Token.deploy("Token B", "TB", 10000000);

        await tokenA.mint(acc1.address, 1000);
        await tokenB.mint(acc2.address, 1000);

        const _swapToken = await ethers.getContractFactory("SwapToken");
        swapToken = await _swapToken.deploy();
        await swapToken.initialize(treasury.address);

        await tokenA.connect(acc1).approve(swapToken.target, 100000);
        await tokenB.connect(acc2).approve(swapToken.target, 100000);
    });

    describe("Init contract", function () {
        it("should correctly initialize contract with the treasury and fee percentage", async function () {
            expect(await swapToken.owner()).to.equal(owner.address);
            expect(await swapToken.treasury()).to.equal(treasury.address);
            expect(await swapToken.feePercentage()).to.equal(BigInt(5));
        });
    });

    describe("Create swap request", function () {
        it("should create a swap request", async function () {
            await expect(swapToken.connect(acc1).createSwapRequest(acc2.address, tokenA.target, tokenB.target, 100, 150))
                .to.emit(swapToken, "SwapRequestCreated").withArgs(0, acc1.address, acc2.address, tokenA.target, tokenB.target, 100, 150);
        });

        it("should fail to create a swap request if amounts are zero", async function () {
            await expect(swapToken.connect(acc1).createSwapRequest(acc2.address, tokenA.target, tokenB.target, 0, 0))
                .to.be.revertedWith("Amounts must be greater than zero");
        });
    });

    describe("Approve request", function () {
        it("should approve a swap request and handle tokens correctly", async function () {
            await swapToken.connect(acc1).createSwapRequest(acc2.address, tokenA.target, tokenB.target, 100, 150);
            await expect(swapToken.connect(acc2).approveSwapRequest(0))
                .to.emit(swapToken, "SwapRequestUpdated").withArgs(0, 1); // 1 corresponds to Approved status
        });

        it("should revert if the request is not in pending status", async function () {
            await swapToken.connect(acc1).createSwapRequest(acc2.address, tokenA.target, tokenB.target, 100, 150);

            await swapToken.connect(acc2).approveSwapRequest(0);
            await expect(swapToken.connect(acc2).approveSwapRequest(0))
                .to.be.revertedWith("Request is not pending");
        });
    });

    describe("Reject request", function () {
        it("should allow rejection by acceptor and return tokens", async function () {
            await swapToken.connect(acc1).createSwapRequest(acc2.address, tokenA.target, tokenB.target, 100, 150);
            await expect(swapToken.connect(acc2).rejectSwapRequest(0))
                .to.emit(swapToken, "SwapRequestUpdated").withArgs(0, 2); // 2 corresponds to Rejected status
        });

        it("should revert if called by someone other than the acceptor", async function () {
            await swapToken.connect(acc1).createSwapRequest(acc2.address, tokenA.target, tokenB.target, 100, 150);
            await expect(swapToken.connect(acc1).rejectSwapRequest(0))
                .to.be.revertedWith("Only acceptor can reject");
        });
    
        it("should revert if the request is not in pending status", async function () {
            await swapToken.connect(acc1).createSwapRequest(acc2.address, tokenA.target, tokenB.target, 100, 150);
    
            await swapToken.connect(acc2).approveSwapRequest(0);
            await expect(swapToken.connect(acc2).rejectSwapRequest(0))
                .to.be.revertedWith("Request is not pending");
        });
    });

    describe("Cancel request", function () {
        it("should allow cancellation by requester and return tokens", async function () {
            await swapToken.connect(acc1).createSwapRequest(acc2.address, tokenA.target, tokenB.target, 100, 150);
            await expect(swapToken.connect(acc1).cancelSwapRequest(0))
                .to.emit(swapToken, "SwapRequestUpdated").withArgs(0, 3); // 3 corresponds to Cancelled status
        });

        it("should revert if called by someone other than the requester", async function () {
            await swapToken.connect(acc1).createSwapRequest(acc2.address, tokenA.target, tokenB.target, 100, 150);
            await expect(swapToken.connect(acc2).cancelSwapRequest(0))
                .to.be.revertedWith("Only requester can cancel");
        });

        it("should revert if the request is not in pending status", async function () {
            await swapToken.connect(acc1).createSwapRequest(acc2.address, tokenA.target, tokenB.target, 100, 150);

            await swapToken.connect(acc2).approveSwapRequest(0);
            await expect(swapToken.connect(acc1).cancelSwapRequest(0))
                .to.be.revertedWith("Request is not pending");
        });
    });

    describe("Set treasury", function () {
        it("should allow the owner to update treasury", async function () {
            await swapToken.setTreasury(acc1.address);
            expect(await swapToken.treasury()).to.equal(acc1.address);
        });

        it("should revert when setting an invalid new treasury address", async function () {
            await expect(swapToken.setTreasury("0x0000000000000000000000000000000000000000"))
                .to.be.revertedWith("Invalid treasury address");
        });
    });

    describe("Update fee percentage", function () {
        it("should allow the owner to update fee percentage", async function () {
            await swapToken.setFeePercentage(10);
            expect(await swapToken.feePercentage()).to.equal(10);
        });
    });
});