// src/reclaim.ts
import { HashchainProtocol } from "@hashchain/sdk";
import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const RPC_URL = process.env.RPC_URL!;
const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS!;
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS || ethers.constants.AddressZero;

async function reclaim() {
    console.log("Starting reclaim process...");

    // Setup
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const merchantAddress = "0x6eb3aFD1c2232b883aa36C6f22100a6F0bD6A9a5";
    console.log("Merchant address:", merchantAddress);

    // Initialize hashchain protocol
    const hashchainProtocol = new HashchainProtocol(
        provider,
        CONTRACT_ADDRESS,
        wallet
    );

    // Reclaim tokens
    try {
        console.log("Reclaiming tokens...");
        await hashchainProtocol.reclaimChannel({
            merchant: merchantAddress,
            tokenAddress: TOKEN_ADDRESS
        });
        console.log("Tokens reclaimed successfully.");
    } catch (error) {
        console.error("Error during reclaim:", error);
    }
}

reclaim().catch(error => {
    console.error("Reclaim process failed:", error);
});