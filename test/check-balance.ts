import { SuiClient } from "@mysten/sui/client";
const c = new SuiClient({ url: "https://fullnode.testnet.sui.io:443" });
c.getBalance({ owner: "0x8a271c5a35e7fdac64fd811b57d6e605f81697fd12b8a1867300abf867429d57" })
  .then(b => console.log("Balance:", Number(b.totalBalance) / 1e9, "SUI"))
  .catch(e => console.error("Error:", e.message));
