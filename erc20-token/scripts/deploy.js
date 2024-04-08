const { ethers } = require("hardhat");

async function main() {
	const [deployer] = await ethers.getSigners()

	console.log("Deploying contracts with the account:", deployer.address)

	console.log("Account balance:", (await deployer.getBalance()).toString())

	const Token = await ethers.getContractFactory("Token")
	const token = await Token.deploy(
		"TES",
		"TES",
		"1000000000000000000000",
		"0x001D02127d7D798DCFC8a42f267d163d54C00198"
	)

	console.log("Token address:", token.address)
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error)
		process.exit(1)
	})