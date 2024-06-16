import "@openzeppelin/hardhat-upgrades";
import "@nomicfoundation/hardhat-toolbox";
import "@typechain/hardhat";
import "solidity-coverage";
import "hardhat-gas-reporter";
import dotenv from "dotenv";
dotenv.config();

const { BSC_TESTNET_URL, BSC_TESTNET_PRIVATE_KEY, BSC_API_KEY } = process.env;

module.exports = {
	solidity: "0.8.24",
	paths: {
		tests: "./tests",
	},
	gasReporter: {
		enabled: true,
		currency: 'USD',
	  },
	networks: {
		testnetBsc: {
			url: BSC_TESTNET_URL,
			accounts: [`0x${BSC_TESTNET_PRIVATE_KEY}`],
			timeout: 1000000,
		},
	},
	etherscan: {
		apiKey: {
			bscTestnet: BSC_API_KEY
		}
  	},
	mocha: {
		timeout: 20000
	}
}
