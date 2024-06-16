const { ethers, upgrades } = require("hardhat");

async function main() {
	const [deployer] = await ethers.getSigners();

	console.log("Deploying contracts with the account:", deployer.address);

	const contractMarketplace = await ethers.getContractFactory("NFTMarketplace");
	const marketplace = await upgrades.deployProxy(contractMarketplace, [deployer.address, 25, 25], { initializer: "initialize" });

	console.log("NFT Marketplace address:", marketplace.target);
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error)
		process.exit(1)
	});