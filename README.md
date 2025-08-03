# Micropay Agents

Micropay-Agents is a TypeScript-based framework enabling off-chain micropayment channels between a client agent and a merchant agent, secured by smart contracts on Ethereum. It demonstrates atomic, trustless payment-for-data using hashchain commitments and Hashchain Protocol contract integration. This architecture enables a true pay-as-you-go model, where users pay incrementally for each data unit or API call as it is consumed.

The system utilizes the [Hashchain Protocol](hashchainprotocol.com) in the backend, providing a cryptographically secure and efficient way to manage conditional payments and prevent fraud. Each payment is validated by revealing the next preimage in a cryptographic hashchain, ensuring that only valid, sequential payments are accepted by the merchant. This protocol underpins reliable and trustless micropayment flows, making Micropay-Agents suitable for usage-based billing, paid APIs, IoT data monetization, and other granular payment scenarios.

This architecture enables a true pay-as-you-go model, where users or autonomous AI agents pay incrementally for each data unit or API call as consumed.

## Key Features

### Merchant Agent

- Provides API to negotiate channels, serve data, receive micropayments, and redeem channels.
- Listens for on-chain `ChannelCreated` events for channel tracking.
- Verifies hashchain payment tokens in-memory for security.
- Executes on-chain channel redemption with MuPay smart contract.

### Client Agent

- Negotiates payment channel terms via HTTP with the merchant.
- Generates cryptographic hashchains per the Hashchain Protocol to secure micropayments.
- Creates payment channels and manages token payments on-chain.
- Sends sequential payment tokens ("preimages") corresponding to actual consumption.

### Use Case

This project also demonstrates how autonomous AI agents can transact with each other, securely paying for API access or data exchange using trustless, pay-as-you-go micropayment channels.

### Technology Stack

TypeScript, Express.js, ethers.js, dotenv, Hashchain Protocol (sdk and smart contract).