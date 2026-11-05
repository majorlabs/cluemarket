# Initial integration findings

Status: preliminary investigation, not an end-to-end proof. Checked 2026-11-05.

- Polymarket's public Gamma markets and public-search endpoints returned HTTP 200 with market results. The agent has a typed search tool, but an end-to-end agent run has not been verified.
- [Polymarket trading overview](https://docs.polymarket.com/trading/overview) describes connecting a signer to an account wallet, funding it, granting approvals, and signing and submitting orders to the CLOB. Order fills, settlement and positions must be tracked. Outcome identifiers vary by protocol version; consult the [current order guide](https://docs.polymarket.com/trading/quickstart).
- [Geographic restrictions](https://docs.polymarket.com/api-reference/geoblock) must be checked for the actual user before orders. No user eligibility was checked and no trade was attempted.
- The NEAR AI model catalog returned HTTP 200. This is not authenticated inference, verification of privacy, or proof of attestation. The environment has no configured model credential.
- The [NEAR Intents 1Click API](https://docs.near-intents.org/) token list returned HTTP 200. This does not establish a valid route, quote, destination compatibility, deposit, refund, or settlement. No funding was attempted.
- Research source provider selection, private storage, authentication, interface, evidence synthesis, and the complete research journey remain unimplemented and unverified.

## Funding route investigation (2026-11-05)

The current NEAR Intents 1Click token list returned Polygon (`pol`) native USDC, contract `0x3c499c542cef5e3811e1192ce70d8cc03d5c3359`. The current Polymarket Bridge supported-assets response lists the same Polygon asset and contract, with a $2 minimum at retrieval. That is a candidate route through a Polymarket Bridge deposit address, not proof of execution or compatibility with a particular account. Check the live lists, quote, fees, minimums, recipient type, refund and venue eligibility for each use. No quote, deposit, conversion, fill, or refund was tested. Polymarket's [pUSD documentation](https://docs.polymarket.com/concepts/pusd) describes pUSD as the trading collateral and specifies USDC.e for direct onramp wrapping; Polygon native USDC should not be treated as directly interchangeable with that wrapping path. [Bridge supported assets](https://docs.polymarket.com/trading/bridge/supported-assets) and [NEAR Intents](https://docs.near-intents.org/) describe the separate bridge and swap services.
