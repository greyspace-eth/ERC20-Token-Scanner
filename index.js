require('dotenv').config();
const ethers = require('ethers');
const axios = require('axios');

const apikey = process.env.API_KEY;
const genericERC20ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function totalSupply() view returns (uint256)",
];
const provider = new ethers.providers.WebSocketProvider(process.env.INFURA_WSS_URL);
const HEARTBEAT_INTERVAL = 30000;  // 30 seconds
const HEARTBEAT_TIMEOUT = 10000;   // 10 seconds
let heartbeatInterval = null;

function startHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
    }

    heartbeatInterval = setInterval(async () => {
        let responded = false;

        const timeout = setTimeout(() => {
            if (!responded) {
                console.warn('Heartbeat timeout. Connection might be lost.');
                clearInterval(heartbeatInterval);  
                provider.removeAllListeners('block');
                initializeListeners();  
            }
        }, HEARTBEAT_TIMEOUT);

        try {
            await provider.getBlockNumber();
            responded = true;
            clearTimeout(timeout);  
        } catch (error) {
            console.error('Heartbeat check failed:', error);
            responded = false;
        }
    }, HEARTBEAT_INTERVAL);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function searchForWebsiteLink(sourceCode) {
    const excludeLinks = [
        "https://eips.ethereum.org",
        "https://solidity.readthedocs.io",
        "https://github.com",
        "https://gitbook.com",
        "https://hardhat.org",
        "https://forum.zeppelin",
        "https://forum.openzeppelin",
        "https://diligence.consensys",
        "https://blog.",
        "https://consensys.",
        "https://docs.",
        "https://cs.",
        "https://web3js.",
        "https://ethereum.github",
        "https://https.eth.wiki",
    ];
    const links = sourceCode.match(/https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+(?![\w\-._~:/?#[\]@!$&'()*+,;=%])/g) || [];
    return links.filter(link => !excludeLinks.some(excluded => link.startsWith(excluded)));
}

async function getWebsiteOfContract(contractAddress) {
    try {
        const apiUrl = `https://api.etherscan.io/api?module=contract&action=getsourcecode&address=${contractAddress}&apikey=${apikey}`;
        const response = await axios.get(apiUrl);
        if (response.data && response.data.result) {
            const sourceCode = response.data.result[0].SourceCode;
            const websites = await searchForWebsiteLink(sourceCode);
            return websites.length > 0 ? websites : ['No website link available'];
        }
        throw new Error('Contract Source Code not found.');
    } catch (error) {
        console.error('Error retrieving contract source code:', error);
        throw error;
    }
}

function initializeListeners() {
    provider.on('block', async (blockNumber) => {
        try {
            const block = await provider.getBlockWithTransactions(blockNumber);
            for (let transaction of block.transactions) {
                try {
                    if (transaction.to === null) {
                        const receipt = await provider.getTransactionReceipt(transaction.hash);
                        if (receipt.status) {
                            await sleep(120000); //wait for 2 mins for contract to get verified
                            const tokenContract = new ethers.Contract(receipt.contractAddress, genericERC20ABI, provider);
                            const tokenName = await tokenContract.name();
                            const tokenSymbol = await tokenContract.symbol();
                            const tokensTotalSupplyRaw = await tokenContract.totalSupply();
                            const tokenDecimals = await tokenContract.decimals();
                            const tokenTotalSupply = ethers.utils.formatUnits(ethers.BigNumber.from(tokensTotalSupplyRaw), tokenDecimals);
                            const websites = await getWebsiteOfContract(receipt.contractAddress);
                            console.log(`New Token Found:
                                    - Token Address: ${receipt.contractAddress}
                                    - Token Name: ${tokenName}
                                    - Token Symbol: ${tokenSymbol}
                                    - Total Supply: ${tokenTotalSupply}
                                    - Decimals: ${tokenDecimals}
                                    - Websites: ${websites.join(', ')}`);
                        }
                    }
                } catch (transactionError) {
                    console.error(`Error in transaction ${transaction.hash}`, transactionError);
                }
            }
        } catch (blockError) {
            console.error(`Error in block ${blockNumber}:`, blockError);
        }
    });
    startHeartbeat();
}

initializeListeners();

provider.on('error', async (error) => {
    console.error('WebSocket error:', error);
    await sleep(5000);
    provider.removeAllListeners('block');
    initializeListeners();
    startHeartbeat();
});

provider.on('close', async (error) => {
    console.error('WebSocket close:', error);
    await sleep(5000);
    provider.removeAllListeners('block');
    initializeListeners();
    startHeartbeat();
});
