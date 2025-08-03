import { HashchainProtocol, hashchain, generateSeed, getTokenAllowance, approveToken} from "@hashchain/sdk";
import { ethers } from "ethers";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const MERCHANT_AGENT_URL = process.env.MERCHANT_AGENT_URL || "http://localhost:3001";
const RPC_URL = process.env.RPC_URL!;
const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS!;
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS || ethers.constants.AddressZero;
const CHANNEL_AMOUNT = process.env.CHANNEL_AMOUNT ? parseInt(process.env.CHANNEL_AMOUNT) : 100000;
const HASHCHAIN_LENGTH = process.env.HASHCHAIN_LENGTH ? parseInt(process.env.HASHCHAIN_LENGTH) : 20;

const portfolioAddresses = [
  "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
  "0x53d284357ec70ce289d6d64134dfac8e511c8a3d", 
  "0xfe9e8709d3215310075d67e3ed32a380ccf451c8", 
  "0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0", 
  "0x28c6c06298d514db089934071355e5743bf21d60"  
];

async function main() {
    console.log("Starting client agent...");
    
    // Setup
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const payerAddress = wallet.address;
    console.log("Payer address:", payerAddress);

    // generate hashchain and secret
    const seed = await generateSeed();
    const paymentHashchain = await hashchain(seed, HASHCHAIN_LENGTH);
    const trustAnchor = paymentHashchain[HASHCHAIN_LENGTH];

    // negotiate payment channel terms
    console.log("Negotiating payment channel terms...");
    const negotiationResponse = await axios.post(`${MERCHANT_AGENT_URL}/negotiate`, {
        payer: payerAddress,
        contract: CONTRACT_ADDRESS,
        token: TOKEN_ADDRESS,
        amount: CHANNEL_AMOUNT
    }, {
        timeout: 10000 // 10 second timeout
    });
    if (negotiationResponse.status !== 200) {
        throw new Error("Failed to negotiate payment channel terms");
    }
    const merchantAddress = negotiationResponse.data.merchantAddress;
    console.log(`Negotiated with merchant: ${merchantAddress}`);

    // initialize hashchain protocol
    const hashchainProtocol = new HashchainProtocol(
        provider,
        CONTRACT_ADDRESS,
        wallet
    );

    // create payment channel
    const createChannelParams = {
        merchant: merchantAddress,
        tokenAddress: TOKEN_ADDRESS,
        trustAnchor: trustAnchor,
        amount: CHANNEL_AMOUNT,
        numberOfTokens: HASHCHAIN_LENGTH,
        merchantWithdrawAfterBlocks: 1,
        payerWithdrawAfterBlocks: 1
    };

    // check token allowance
    const allowance = await getTokenAllowance(wallet, TOKEN_ADDRESS, CONTRACT_ADDRESS);
    console.log(`Current token allowance: ${allowance.toString()}`);
    const channelAmountBN = ethers.BigNumber.from(CHANNEL_AMOUNT);
    if (allowance.lt(channelAmountBN)) {
        console.log("Approving token allowance...");
        const approveTx = await approveToken(wallet, TOKEN_ADDRESS, CONTRACT_ADDRESS, channelAmountBN);
        await approveTx.wait();
        console.log("Token allowance approved. Waiting for state propagation...");
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    await hashchainProtocol.createChannel(createChannelParams);
    console.log("Payment channel created successfully");

    // wait for few seconds to ensure merchant detects the channel creation
    console.log("Waiting for merchant to detect channel creation...");
    await new Promise(resolve => setTimeout(resolve, 2000));

    // request data from merchant and pay
    let tokenUsed = 0;
    
    while (tokenUsed < HASHCHAIN_LENGTH && tokenUsed < portfolioAddresses.length) {
        try {
            // Fetch portfolio data from merchant for the current address in the list
            // We expect the response to contain portfolio information for portfolioAddresses[tokenUsed]
            const dataResponse = await axios.get(`${MERCHANT_AGENT_URL}/data`, {
                params: {
                    address: portfolioAddresses[tokenUsed]
                }
            });
            // Log the full portfolio data received from merchant
            console.log("Received data from merchant:", JSON.stringify(dataResponse.data, null, 2));
            await new Promise(resolve => setTimeout(resolve, 1000));

            // upon successfully receiving data, send payment token (preimage)
            tokenUsed++;
            const preimage = paymentHashchain[HASHCHAIN_LENGTH - tokenUsed];

            const paymentResponse = await axios.post(`${MERCHANT_AGENT_URL}/payment`, {
                payerAddress: payerAddress,
                preimage: preimage,
                tokensUsed: 1
            }, {
                timeout: 5000 // 5 second timeout
            });
            console.log(`Payment #${tokenUsed} sent. Merchant response: `, paymentResponse.data.message);
        } catch (error) {
            console.error("Error during data request or payment:", error);
            break; // Exit loop on error
        }
    }

    console.log("All requested data paid for or hashchain fully consumed.");

    // wait for 2 seconds before redeeming the channel
    console.log("Waiting for 2 seconds before redeeming the channel...");
    await new Promise(resolve => setTimeout(resolve, 2000));

    // redeem channel
    await axios.post(`${MERCHANT_AGENT_URL}/redeem`, {
        payerAddress: payerAddress
    }, {
        timeout: 10000 // 10 second timeout
    });
    console.log("Payment channel redeemed successfully");
}

console.log("Script started executing...");
main().catch((error) => {
  console.error("Error in main execution:", error);
  console.error("Error stack:", error.stack);
  process.exit(1);
});
