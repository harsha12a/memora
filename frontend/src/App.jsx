import React, { useEffect, useMemo, useState } from "react";
import { AptosClient } from "aptos";
import "./index.css";

const NODE_URL = "https://fullnode.testnet.aptoslabs.com/v1";
const MODULE_ADDRESS = "0xa65c51cc112a8275126da00b1aa6bf0385c8a226f7293efe43d31b0cf77df366";
const FN_CREATE = `${MODULE_ADDRESS}::vault_v8::create_capsule`;
const FN_REQUEST_UNLOCK = `${MODULE_ADDRESS}::vault_v8::request_unlock`;
const FN_GET_LATEST_ID = `${MODULE_ADDRESS}::vault_v8::get_latest_capsule_id`;

const client = new AptosClient(NODE_URL);

const MODULES = [
  { id: 1, name: "Time Capsule", capsuleType: 1, needsGeo: false, needsTime: true, defaultContrib: 1 },
  { id: 2, name: "Collaborative Capsule", capsuleType: 2, needsGeo: false, needsTime: true, defaultContrib: 5 },
  { id: 3, name: "Geo Capsule", capsuleType: 4, needsGeo: true, needsTime: false, defaultContrib: 1 },
  { id: 4, name: "Geo + Time Capsule", capsuleType: 4, needsGeo: true, needsTime: true, defaultContrib: 5 },
];

function toU8ArrayHex(u8) {
  return "0x" + Array.from(u8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function genUnlockCode() {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  const bytes = Array.from(new TextEncoder().encode(code));
  return { code, bytes };
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function isValidAptosAddress(address) {
  return typeof address === "string" && /^0x[0-9a-fA-F]{64}$/.test(address);
}

export default function App() {
  const [account, setAccount] = useState(null);
  const [selected, setSelected] = useState(1);
  const [fileHashBytes, setFileHashBytes] = useState([]);
  const [geoLat, setGeoLat] = useState("");
  const [geoLong, setGeoLong] = useState("");
  const [geoRadius, setGeoRadius] = useState("50");
  const [unlockAfterDays, setUnlockAfterDays] = useState("7");
  const [maxContrib, setMaxContrib] = useState("");
  const [unlockCode, setUnlockCode] = useState([]);
  const [unlockCodeString, setUnlockCodeString] = useState("");
  const [status, setStatus] = useState("");
  const [ownerAddr, setOwnerAddr] = useState("");
  const [enterCode, setEnterCode] = useState("");
  const [enterCapsuleId, setEnterCapsuleId] = useState("");

  const moduleCfg = useMemo(() => MODULES.find((m) => m.id === selected), [selected]);

  useEffect(() => {
    const { code, bytes } = genUnlockCode();
    setUnlockCode(bytes);
    setUnlockCodeString(code);
  }, [selected]);

  async function connectWallet() {
    if (!window.aptos) {
      alert("Petra wallet not found. Please install Petra.");
      return;
    }
    try {
      const res = await window.aptos.connect();
      setAccount(res.address);
      setStatus(`Connected: ${res.address}`);
    } catch (e) {
      setStatus("Failed to connect wallet");
    }
  }

  async function onFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus("Hashing file...");
    const buf = await file.arrayBuffer();
    const hashBuf = await crypto.subtle.digest("SHA-256", buf);
    const bytes = Array.from(new Uint8Array(hashBuf));
    setFileHashBytes(bytes);
    const { code, bytes: newCodeBytes } = genUnlockCode();
    setUnlockCode(newCodeBytes);
    setUnlockCodeString(code);
    setStatus(`File hashed. New unlock code generated.`);
  }

  function computedParams() {
    const now = nowSec();
    const unlock_time =
      moduleCfg.needsTime
        ? String(now + (Number.isFinite(+unlockAfterDays) ? +unlockAfterDays * 24 * 3600 : 7 * 24 * 3600))
        : "0";
    const lat = moduleCfg.needsGeo ? (geoLat.trim() || "0") : "0";
    const long = moduleCfg.needsGeo ? (geoLong.trim() || "0") : "0";
    const radius = moduleCfg.needsGeo ? (geoRadius.trim() || "0") : "0";
    const maxC = maxContrib.trim() ? maxContrib.trim() : String(moduleCfg.defaultContrib);

    return {
      capsule_type: moduleCfg.capsuleType,
      unlock_time,
      geo_lat: lat,
      geo_long: long,
      geo_radius: radius,
      max_contributors: maxC,
    };
  }

  async function createCapsule() {
    if (!account) return alert("Connect wallet first");
    if (!fileHashBytes.length) return alert("Please upload a document first");
    if (moduleCfg.needsGeo && (!geoLat || !geoLong)) return alert("Please provide latitude & longitude");

    const params = computedParams();

    try {
      setStatus("Submitting transaction...");
      const payload = {
        type: "entry_function_payload",
        function: FN_CREATE,
        type_arguments: [],
        arguments: [
          Number(params.capsule_type),
          fileHashBytes,
          unlockCode,
          params.unlock_time,
          params.geo_lat,
          params.geo_long,
          params.geo_radius,
          params.max_contributors,
        ],
      };
      const tx = await window.aptos.signAndSubmitTransaction(payload);
      await client.waitForTransaction(tx.hash);

      // Fetch latest capsule ID using view function
      const viewPayload = {
        function: FN_GET_LATEST_ID,
        type_arguments: [],
        arguments: [account],
      };
      const [latestId] = await client.view(viewPayload);

      const unlockTimeUnix = Number(params.unlock_time);
      const unlockDate = new Date(unlockTimeUnix * 1000).toLocaleString();
      setEnterCapsuleId(latestId);  // Pre-fill for unlock
      setStatus(`✅ Capsule created! Unlock Code: ${unlockCodeString} | Tx: ${tx.hash} | Unlock Date: ${unlockDate} | Capsule ID: ${latestId}`);

      // Copy unlock code to clipboard
      navigator.clipboard.writeText(unlockCodeString).then(() => {
        alert('Unlock code copied to clipboard!');
      });
    } catch (e) {
      setStatus(`❌ Error: ${e?.message || e}`);
      console.error(e);
    }
  }

  async function requestUnlock() {
    if (!account) return alert("Connect wallet first");
    if (!ownerAddr) return alert("Owner address required");
    if (!isValidAptosAddress(ownerAddr)) return alert("Invalid owner address. Must be a 64-character hexadecimal string starting with '0x'.");
    if (!enterCapsuleId) return alert("Capsule ID required");
    if (!enterCode) return alert("Unlock code required");

    const enterCodeBytes = Array.from(new TextEncoder().encode(enterCode));

    try {
      setStatus("Requesting unlock...");
      console.log("Request Unlock Arguments:", { ownerAddr, capsuleId: enterCapsuleId, enterCodeBytes });
      if (ownerAddr.toLowerCase() !== account.toLowerCase()) {
        setStatus("❌ Error: Owner address does not match connected account");
        return;
      }

      const payload = {
        type: "entry_function_payload",
        function: FN_REQUEST_UNLOCK,
        type_arguments: [],
        arguments: [ownerAddr, enterCapsuleId, enterCodeBytes],
      };
      const tx = await window.aptos.signAndSubmitTransaction(payload);
      await client.waitForTransaction(tx.hash);
      setStatus(`✅ Unlock requested. Tx: ${tx.hash}`);
    } catch (e) {
      setStatus(`❌ Unlock error: ${e?.message || e}`);
      console.error(e);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-blue-50 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-blue-500 mb-2">
            Digital Vault
          </h1>
          <p className="text-blue-600">Secure your files on the Aptos blockchain</p>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6 flex flex-col md:flex-row items-center justify-between">
          <div className="mb-4 md:mb-0">
            <h2 className="text-lg font-semibold text-gray-800">Wallet Status</h2>
            <p className={`text-sm ${account ? "text-green-600" : "text-gray-500"}`}>
              {account ? `Connected: ${account.slice(0, 6)}...${account.slice(-4)}` : "Not connected"}
            </p>
          </div>
          {!account ? (
            <button
              onClick={connectWallet}
              className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-blue-500 text-white rounded-lg shadow-md hover:shadow-lg transition-all duration-300 font-medium"
            >
              Connect Petra Wallet
            </button>
          ) : (
            <div className="px-4 py-2 bg-green-100 text-green-800 rounded-full text-sm font-medium">
              Connected
            </div>
          )}
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Select Capsule Type</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {MODULES.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelected(m.id)}
                className={`p-5 rounded-xl border transition-all duration-200 ${
                  selected === m.id
                    ? "border-indigo-500 bg-indigo-50 shadow-md ring-2 ring-indigo-200"
                    : "border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300"
                }`}
              >
                <div className="font-semibold text-gray-800">{m.name}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {m.needsGeo && (
                    <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">Geo</span>
                  )}
                  {m.needsTime && (
                    <span className="px-2 py-1 bg-purple-100 text-purple-800 text-xs rounded-full">Time</span>
                  )}
                  {m.capsuleType === 2 && (
                    <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">Collaborative</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-indigo-600 to-blue-500 p-5">
            <h2 className="text-xl font-semibold text-white">Create New Capsule</h2>
          </div>
          <div className="p-6 space-y-6">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Document (required)</label>
              <div className="flex items-center space-x-4">
                <label className="flex-1">
                  <div className="flex flex-col items-center justify-center px-6 py-8 border-2 border-dashed border-gray-300 rounded-lg hover:border-indigo-500 transition-colors cursor-pointer">
                    <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="mt-2 text-sm text-gray-600">Click to upload file</span>
                    <input type="file" onChange={onFileChange} className="hidden" />
                  </div>
                </label>
                {fileHashBytes.length > 0 && (
                  <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                    <div className="flex items-center text-green-700">
                      <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <span className="text-sm font-medium">File hashed</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {moduleCfg.needsGeo && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Geo Parameters</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Latitude</label>
                    <input
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      placeholder="e.g. 37.7749"
                      value={geoLat}
                      onChange={(e) => setGeoLat(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Longitude</label>
                    <input
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      placeholder="e.g. -122.4194"
                      value={geoLong}
                      onChange={(e) => setGeoLong(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Radius (meters)</label>
                    <input
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      type="number"
                      value={geoRadius}
                      onChange={(e) => setGeoRadius(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            {moduleCfg.needsTime && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Time Parameters</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Unlock After (days)</label>
                    <input
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      type="number"
                      value={unlockAfterDays}
                      onChange={(e) => setUnlockAfterDays(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Max Contributors</label>
                <input
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  type="number"
                  placeholder={`Default ${moduleCfg.defaultContrib}`}
                  value={maxContrib}
                  onChange={(e) => setMaxContrib(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unlock Code</label>
                <div className="relative">
                  <input
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 font-mono"
                    value={unlockCodeString}
                    readOnly
                  />
                  <button
                    onClick={() => {
                      const { code, bytes } = genUnlockCode();
                      setUnlockCode(bytes);
                      setUnlockCodeString(code);
                    }}
                    className="absolute right-2 top-1/2 transform -translate-y-1/2 text-indigo-600 hover:text-indigo-800"
                    title="Generate new code"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-4">
              <button
                onClick={createCapsule}
                className={`w-full py-3 px-6 bg-gradient-to-r from-indigo-600 to-blue-500 text-white font-medium rounded-lg shadow-md hover:shadow-lg transition-all duration-300 ${
                  (!account || !fileHashBytes.length) ? "opacity-50 cursor-not-allowed" : "hover:from-indigo-700 hover:to-blue-600"
                }`}
                disabled={!account || !fileHashBytes.length}
              >
                Create Secure Capsule
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-purple-600 to-indigo-500 p-5">
            <h2 className="text-xl font-semibold text-white">Request Unlock</h2>
          </div>
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Owner Address</label>
                <input
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  placeholder="0x..."
                  value={ownerAddr}
                  onChange={(e) => setOwnerAddr(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Capsule ID</label>
                <input
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  placeholder="0"
                  type="number"
                  value={enterCapsuleId}
                  onChange={(e) => setEnterCapsuleId(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unlock Code</label>
                <input
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  placeholder="ABCDEF"
                  value={enterCode}
                  onChange={(e) => setEnterCode(e.target.value)}
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={requestUnlock}
                  className="w-full py-2 px-4 bg-gradient-to-r from-purple-600 to-indigo-500 text-white font-medium rounded-lg shadow-md hover:shadow-lg hover:from-purple-700 hover:to-indigo-600 transition-all duration-300"
                >
                  Request Unlock
                </button>
              </div>
            </div>
            <div className="bg-purple-50 p-4 rounded-lg border border-purple-100">
              <h4 className="text-sm font-medium text-purple-800 mb-2">Unlock Conditions</h4>
              <ul className="text-xs text-purple-700 space-y-1">
                <li className="flex items-start">
                  <svg className="w-4 h-4 mr-1 mt-0.5 flex-shrink-0 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>If time not reached → on-chain abort (E_NOT_UNLOCKED)</span>
                </li>
                <li className="flex items-start">
                  <svg className="w-4 h-4 mr-1 mt-0.5 flex-shrink-0 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>If geo not verified → abort (E_GEO_NOT_VERIFIED)</span>
                </li>
                <li className="flex items-start">
                  <svg className="w-4 h-4 mr-1 mt-0.5 flex-shrink-0 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>If wrong code → abort (E_BAD_CODE)</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {status && (
          <div
            className={`p-4 rounded-lg ${
              status.startsWith("✅") ? "bg-green-50 text-green-800" : status.startsWith("❌") ? "bg-red-50 text-red-800" : "bg-blue-50 text-blue-800"
            }`}
          >
            <div className="flex items-start">
              {status.startsWith("✅") ? (
                <svg className="w-5 h-5 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              ) : status.startsWith("❌") ? (
                <svg className="w-5 h-5 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-5 h-5 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              )}
              <span className="text-sm">{status}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}