require("@nomiclabs/hardhat-waffle")
require("@nomiclabs/hardhat-etherscan")
require("dotenv").config()

const { BSC_TESTNET_URL, BSC_TESTNET_PRIVATE_KEY, BSC_API_KEY } = process.env;

module.exports = {
	solidity: "0.8.24",
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
  }
}
