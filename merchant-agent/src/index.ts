import express, { Request, Response } from 'express';
import { ethers, Contract, ZeroAddress, keccak256 } from 'ethers';
import { verifyHashchainToken } from "@hashchain/sdk";
import axios from 'axios';
import dotenv from 'dotenv';
import MuPayAbi from '../../abi/MuPay.abi.json';

dotenv.config();

// --- Configuration ---
const app = express();
const PORT = process.env.MERCHANT_PORT || 3001;
const provider = new ethers.WebSocketProvider(process.env.WS_RPC_URL!);
const merchantWallet = new ethers.Wallet(process.env.MERCHANT_PRIVATE_KEY!, provider);
const oneinch_api_key = process.env.ONEINCH_API_KEY!;
if (!oneinch_api_key) {
    throw new Error("1inch API key is not set in environment variables");
}

// --- Contract Setup ---
const muPayContract = new Contract(process.env.MUPAY_CONTRACT_ADDRESS!, MuPayAbi, merchantWallet);

// --- Middleware ---
app.use(express.json());

// --- Agent State (for simplicity, using in-memory storage) ---
interface ChannelState {
    payer: string;
    token: string;
    trustAnchor: string;
    totalTokens: number;
    latestPreimage: string;
    tokensUsed: number;
}
const activeChannels = new Map<string, ChannelState>();

// --- Routes ---
app.post('/negotiate', (req: Request, res: Response) => {
    const { payer, contract, token, amount } = req.body;
    console.log(`Negotiation request from ${payer} for amount: ${amount}.`);
    res.status(200).json({
        message: "Terms accepted.",
        merchantAddress: merchantWallet.address,
    });
});

app.get('/data', async (req: Request, res: Response) => {
    // Extract user Ethereum address from query parameters, return 400 error if missing
    const userAddress = req.query.address as string;
    if (!userAddress) {
        return res.status(400).json({ error: "Missing address query parameter" });
    }

    // Prepare 1inch Portfolio API endpoint and request configuration with authentication and parameters
    const url = "https://api.1inch.dev/portfolio/portfolio/v5.0/general/current_value";

    const config = {
        headers: {
            Authorization: `Bearer ${oneinch_api_key}`,
        },
        params: {
            addresses: [userAddress],
            chain_id: "1",       // Ethereum mainnet
            use_cache: "true",   // or "false" to always get fresh data
        },
        paramsSerializer: {
            indexes: null,       // preserving correct params serialization
        },
    };

    try {
        console.log(`Fetching portfolio data for address: ${userAddress}`);
        // Fetch portfolio data from 1inch API for the specified address
        const response = await axios.get(url, config);
        console.log("1inch API returned data:", response.data ? "success" : "empty");
        // Return the portfolio data JSON to the client
        res.json(response.data);
    } catch (error: any) {
        console.error("Error fetching portfolio data from 1inch:", error.response?.data || error.message);
        res.status(500).json({ error: "Failed to fetch portfolio data." });
    }
});

app.post('/payment', (req: Request, res: Response) => {
    const { payerAddress, preimage, tokensUsed } = req.body;
    console.log(`Preimage: ${preimage}, Tokens Used: ${tokensUsed} for payer ${payerAddress}`);

    if (!payerAddress || !preimage || !tokensUsed) {
        return res.status(400).json({ error: "payerAddress, preimage, and tokensUsed are required." });
    }

    let payer = payerAddress.toLowerCase();
    const channel = activeChannels.get(payer);
    if (!channel) {
        return res.status(404).json({ error: "No active channel found for this payer." });
    }

    // Validate the received token
    if (!verifyHashchainToken(channel.latestPreimage, preimage, tokensUsed)) {
        console.error(`Validation FAILED for payer ${payer}`);
        return res.status(400).json({ error: "Invalid token. Hashchain verification failed." });
    }

    console.log(`Payment validation SUCCESSFUL for payer ${payer}.`);

    // Update channel state
    channel.latestPreimage = preimage;
    channel.tokensUsed = channel.tokensUsed + tokensUsed;
    activeChannels.set(payer, channel);

    res.status(200).json({ message: "Payment received and validated." });
});

/**
 * @notice Endpoint to trigger the on-chain redemption of a channel's funds.
 */
app.post('/redeem', async (req: Request, res: Response) => {
    const { payerAddress } = req.body;
    if (!payerAddress) {
        return res.status(400).json({ error: "payerAddress is required." });
    }

    let payer = payerAddress.toLowerCase();
    const channel = activeChannels.get(payer);
    if (!channel) {
        return res.status(404).json({ error: "No active channel found for this payer to redeem." });
    }

    if (!channel.latestPreimage || channel.tokensUsed === 0) {
        return res.status(400).json({ error: "No payments have been made on this channel." });
    }

    try {
        console.log(`\n--- Redeeming Channel ---`);
        console.log(`  Payer: ${channel.payer}`);
        console.log(`  Final Preimage: ${channel.latestPreimage}`);
        console.log(`  Tokens Used: ${channel.tokensUsed}`);
        console.log(`-------------------------\n`);

        const tx = await muPayContract.redeemChannel(
            channel.payer,
            channel.token,
            channel.latestPreimage,
            channel.tokensUsed
        );

        console.log(`Redemption transaction sent! Hash: ${tx.hash}`);
        await tx.wait(); // Wait for the transaction to be mined
        console.log(`Redemption successful! Channel for ${payerAddress} is closed.`);

        // Clean up the channel from memory
        activeChannels.delete(payer);

        res.status(200).json({ message: "Channel redeemed successfully.", txHash: tx.hash });

    } catch (error: any) {
        console.error("Error redeeming channel:", error.reason || error.message);
        res.status(500).json({ error: "Failed to redeem channel.", details: error.reason || error.message });
    }
});

// --- Blockchain Event Listener ---

function listenForChannels() {
    console.log(`Watching for ChannelCreated events for merchant: ${merchantWallet.address}`);

    muPayContract.on("ChannelCreated", (payer, merchant, token, amount, numberOfTokens, merchantWithdrawAfterBlocks) => {
        // We only care about channels created for our agent
        if (merchant.toLowerCase() === merchantWallet.address.toLowerCase()) {
            console.log(`\n--- New Channel Detected ---`);
            console.log(`  Payer: ${payer}`);
            console.log(`  Token: ${token === ZeroAddress ? 'ETH' : token}`);
            console.log(`  Amount: ${ethers.formatEther(amount)}`);
            console.log(`  Total Tokens: ${numberOfTokens}`);
            console.log(`--------------------------\n`);

            if (activeChannels.has(payer)) {
                console.warn(`Channel for ${payer} already exists. Skipping.`);
                return;
            } else {
                payer = payer.toLowerCase();
                muPayContract.channelsMapping(payer, merchant, token).then(channelData => {
                    activeChannels.set(payer, {
                        payer: payer,
                        token: token,
                        trustAnchor: channelData.trustAnchor,
                        totalTokens: Number(numberOfTokens),
                        latestPreimage: channelData.trustAnchor,
                        tokensUsed: 0,
                    });
                    console.log(`Channel for ${payer} successfully stored with trust anchor: ${channelData.trustAnchor}`);
                });
            }
        }
    });
}

app.listen(PORT, () => {
    console.log(`Merchant agent running at http://localhost:${PORT}`);
});

// Start blockchain listener
listenForChannels();