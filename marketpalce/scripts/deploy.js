const { ethers } = require("hardhat");

async function main() {
	const [deployer] = await ethers.getSigners();

	console.log("Deploying contracts with the account:", deployer.address);

	const _swapToken = await ethers.getContractFactory("SwapToken");
	const swapToken = await _swapToken.deploy();

	console.log("Swap token address:", swapToken.target);
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error)
		process.exit(1)
	});