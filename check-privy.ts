import { PrivyClient } from "@privy-io/server-auth";
const privy = new PrivyClient("cmqdm3qtq00fi0djs1ysjka4f", "privy_app_secret_5Hwyuk6CfEsRFVr6eh2YkYv4APtHRCQvzWPgsNBeabfm4HVK6WoYDAC2psxoe2ovTfrmYHmJhNSfXRep7AQByeYs");
console.log("Keys:", Object.keys(privy));
// @ts-ignore
if (privy.api) console.log("api keys:", Object.keys(privy.api));
// @ts-ignore
if (privy.walletApi) console.log("walletApi keys:", Object.keys(privy.walletApi));
