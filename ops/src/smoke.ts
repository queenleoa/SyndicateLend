// Loads the ATS SDK + contracts ABI in Node without touching the network.
const m = await import("./lib/ats.js");
console.log("sdk exports:", Object.keys(m.sdk).length, "Bond:", !!m.sdk.Bond, "SsiManagement:", !!m.sdk.SsiManagement);
const { syntheticIsin } = await import("./lib/isin.js");
console.log("isin", syntheticIsin("XS", "MHTLB2031A"));
const d = await import("./lib/diamond.js");
console.log("IAsset abi fragments:", d.diamond("0x0000000000000000000000000000000000000001").interface.fragments.length);
