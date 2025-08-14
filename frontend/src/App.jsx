import React, { useEffect, useMemo, useState } from "react";
import { AptosClient } from "aptos";
import "./index.css";

const NODE_URL = "https://fullnode.testnet.aptoslabs.com/v1";
const MODULE_ADDRESS = "0xa65c51cc112a8275126da00b1aa6bf0385c8a226f7293efe43d31b0cf77df366";
const FN_CREATE = `${MODULE_ADDRESS}::vault_v13::create_capsule`;
const FN_UPLOAD_CHUNK = `${MODULE_ADDRESS}::vault_v13::upload_chunk`;
const FN_REQUEST_UNLOCK = `${MODULE_ADDRESS}::vault_v13::request_unlock`;
const FN_GET_LATEST_ID = `${MODULE_ADDRESS}::vault_v13::get_latest_capsule_id`;
const FN_GET_FILE_CHUNK = `${MODULE_ADDRESS}::vault_v13::get_file_chunk`;
const FN_GET_CAPSULE_INFO = `${MODULE_ADDRESS}::vault_v13::get_capsule_info`;
const FN_GET_FILE_INFO = `${MODULE_ADDRESS}::vault_v13::get_file_info`;

const client = new AptosClient(NODE_URL);

// Chunk size (50KB to stay under transaction limits)
const CHUNK_SIZE = 51200;

const MODULES = [
  { id: 1, name: "Time Capsule", capsuleType: 1, needsGeo: false, needsTime: true, defaultContrib: 1 },
  { id: 2, name: "Collaborative Capsule", capsuleType: 2, needsGeo: false, needsTime: true, defaultContrib: 5 },
  { id: 3, name: "Geo Capsule", capsuleType: 4, needsGeo: true, needsTime: false, defaultContrib: 1 },
  { id: 4, name: "Geo + Time Capsule", capsuleType: 4, needsGeo: true, needsTime: true, defaultContrib: 5 },
];

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

// Helper function to split file into chunks
function splitFileIntoChunks(fileBytes, chunkSize = CHUNK_SIZE) {
  const chunks = [];
  for (let i = 0; i < fileBytes.length; i += chunkSize) {
    chunks.push(fileBytes.slice(i, i + chunkSize));
  }
  return chunks;
}

// Helper function to compress image if needed
function compressImage(file, maxSize = 1024 * 1024) { // 1MB max before chunking
  return new Promise((resolve) => {
    if (file.size <= maxSize) {
      resolve(file);
      return;
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = () => {
      const ratio = Math.sqrt(maxSize / file.size);
      canvas.width = img.width * ratio;
      canvas.height = img.height * ratio;
      
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      canvas.toBlob((blob) => {
        resolve(blob);
      }, file.type, 0.8);
    };
    
    img.src = URL.createObjectURL(file);
  });
}

export default function App() {
  const [account, setAccount] = useState(null);
  const [selected, setSelected] = useState(1);
  const [file, setFile] = useState(null);
  const [fileBytes, setFileBytes] = useState([]);
  const [fileMimeType, setFileMimeType] = useState("");
  const [geoLat, setGeoLat] = useState("");
  const [geoLong, setGeoLong] = useState("");
  const [geoRadius, setGeoRadius] = useState("50");
  const [unlockAfterDays, setUnlockAfterDays] = useState("0");
  const [maxContrib, setMaxContrib] = useState("");
  const [unlockCode, setUnlockCode] = useState([]);
  const [unlockCodeString, setUnlockCodeString] = useState("");
  const [status, setStatus] = useState("");
  const [ownerAddr, setOwnerAddr] = useState("");
  const [enterCode, setEnterCode] = useState("");
  const [enterCapsuleId, setEnterCapsuleId] = useState("");
  const [unlockLat, setUnlockLat] = useState("");
  const [unlockLong, setUnlockLong] = useState("");
  const [imageUrl, setImageUrl] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [retrievedCapsuleInfo, setRetrievedCapsuleInfo] = useState(null);

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
      setOwnerAddr(res.address);
      setStatus(`Connected: ${res.address}`);
    } catch (e) {
      setStatus("Failed to connect wallet");
    }
  }

  async function onFileChange(e) {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    
    if (!selectedFile.type.startsWith("image/")) {
      setStatus("❌ Please upload an image file.");
      return;
    }

    setStatus("Processing file...");
    
    try {
      // Compress if needed
      const processedFile = await compressImage(selectedFile);
      const buf = await processedFile.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buf));
      
      setFile(processedFile);
      setFileBytes(bytes);
      setFileMimeType(processedFile.type);
      
      const { code, bytes: newCodeBytes } = genUnlockCode();
      setUnlockCode(newCodeBytes);
      setUnlockCodeString(code);
      
      const chunks = splitFileIntoChunks(bytes);
      setStatus(`✅ File processed. Size: ${(bytes.length / 1024).toFixed(2)} KB. Will upload in ${chunks.length} chunks.`);
    } catch (error) {
      setStatus(`❌ Error processing file: ${error.message}`);
      console.error(error);
    }
  }

  function computedParams() {
    const now = nowSec();
    const unlock_time =
      moduleCfg.needsTime
        ? String(now + (Number.isFinite(+unlockAfterDays) ? +unlockAfterDays * 24 * 3600 : 0))
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
    if (!fileBytes.length) return alert("Please upload an image first");
    if (moduleCfg.needsGeo && (!geoLat || !geoLong)) return alert("Please provide latitude & longitude");

    const params = computedParams();
    const mimeTypeBytes = Array.from(new TextEncoder().encode(fileMimeType));
    const chunks = splitFileIntoChunks(fileBytes);

    try {
      setIsUploading(true);
      setUploadProgress(0);
      setStatus("Creating capsule...");
      
      // Step 1: Create capsule
      const createPayload = {
        type: "entry_function_payload",
        function: FN_CREATE,
        type_arguments: [],
        arguments: [
          Number(params.capsule_type),
          mimeTypeBytes,
          unlockCode,
          params.unlock_time,
          params.geo_lat,
          params.geo_long,
          params.geo_radius,
          params.max_contributors,
          fileBytes.length, // total file size
        ],
      };

      const createTx = await window.aptos.signAndSubmitTransaction(createPayload);
      await client.waitForTransaction(createTx.hash);

      // Get the capsule ID
      const viewPayload = { function: FN_GET_LATEST_ID, type_arguments: [], arguments: [account] };
      const [capsuleId] = await client.view(viewPayload);
      
      setStatus(`Capsule created! Now uploading ${chunks.length} chunks...`);

      // Step 2: Upload chunks
      for (let i = 0; i < chunks.length; i++) {
        setStatus(`Uploading chunk ${i + 1} of ${chunks.length}...`);
        setUploadProgress(((i + 1) / chunks.length) * 100);

        const chunkPayload = {
          type: "entry_function_payload",
          function: FN_UPLOAD_CHUNK,
          type_arguments: [],
          arguments: [
            capsuleId,
            i, // chunk index
            Array.from(chunks[i]), // chunk data
            i === chunks.length - 1, // is final chunk
          ],
        };

        const chunkTx = await window.aptos.signAndSubmitTransaction(chunkPayload);
        await client.waitForTransaction(chunkTx.hash);

        // Small delay to prevent rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const unlockDate = new Date(Number(params.unlock_time) * 1000).toLocaleString();
      setEnterCapsuleId(capsuleId);
      setUploadProgress(100);
      setStatus(`✅ Capsule created and uploaded! Unlock Code: ${unlockCodeString} | Capsule ID: ${capsuleId} | Unlock Date: ${unlockDate}`);
      
      navigator.clipboard.writeText(unlockCodeString).then(() => 
        alert('Unlock code copied to clipboard!')
      );

    } catch (e) {
      setStatus(`❌ Error: ${e?.message || e}`);
      console.error(e);
    } finally {
      setIsUploading(false);
    }
  }

  async function requestUnlock() {
    if (!account) return alert("Connect wallet first");
    if (!ownerAddr) return alert("Owner address required");
    if (!isValidAptosAddress(ownerAddr)) return alert("Invalid owner address.");
    if (!enterCapsuleId) return alert("Capsule ID required");
    if (!enterCode) return alert("Unlock code required");

    const enterCodeBytes = Array.from(new TextEncoder().encode(enterCode));

    try {
      setIsUnlocking(true);
      setStatus("Requesting unlock...");

      const payload = {
        type: "entry_function_payload",
        function: FN_REQUEST_UNLOCK,
        type_arguments: [],
        arguments: [ownerAddr, enterCapsuleId, enterCodeBytes],
      };

      const tx = await window.aptos.signAndSubmitTransaction(payload);
      await client.waitForTransaction(tx.hash);

      setStatus(`✅ Unlock requested. Retrieving image...`);
      await retrieveImageAfterUnlock(ownerAddr, enterCapsuleId);
    } catch (e) {
      setStatus(`❌ Unlock error: ${e?.message || e}`);
      console.error(e);
      setIsUnlocking(false);
    }
  }

async function retrieveImageAfterUnlock(ownerAddr, capsuleId) {
  try {
    // Get capsule info
    const infoPayload = { 
      function: FN_GET_CAPSULE_INFO, 
      type_arguments: [], 
      arguments: [ownerAddr, String(capsuleId)] // Ensure capsuleId is a string
    };
    const [capsuleType, capsuleOwner, unlockTime, isUnlocked, isGeoVerified, isComplete, totalChunks, fileSize] = await client.view(infoPayload);

    setRetrievedCapsuleInfo({
      capsuleType,
      capsuleOwner,
      unlockTime: new Date(unlockTime * 1000).toLocaleString(),
      isUnlocked,
      isGeoVerified,
      isComplete,
      totalChunks,
      fileSize
    });

    if (!isUnlocked) {
      setStatus(`❌ Capsule ID ${capsuleId} is not unlocked yet.`);
      setIsUnlocking(false);
      return;
    }

    if (!isComplete) {
      setStatus(`❌ Capsule ID ${capsuleId} upload is not complete yet.`);
      setIsUnlocking(false);
      return;
    }

    // Get file info
    const fileInfoPayload = { 
      function: FN_GET_FILE_INFO, 
      type_arguments: [], 
      arguments: [ownerAddr, String(capsuleId)] // Ensure capsuleId is a string
    };
    const [fileSizeFromContract, mimeTypeBytes, totalChunksFromContract] = await client.view(fileInfoPayload);

    // Convert MIME type bytes back to string
    let mimeType = "image/png";
    if (mimeTypeBytes && mimeTypeBytes.length > 0) {
      try {
        const mimeTypeUint8 = new Uint8Array(mimeTypeBytes);
        mimeType = new TextDecoder().decode(mimeTypeUint8);
      } catch (e) {
        console.warn("Failed to decode MIME type, using default:", e);
      }
    }

    setStatus(`Downloading ${totalChunksFromContract} chunks...`);

    // Download all chunks
    const allChunks = [];
    for (let i = 0; i < totalChunksFromContract; i++) {
      setStatus(`Downloading chunk ${i + 1} of ${totalChunksFromContract}...`);
      
      const chunkPayload = {
        function: FN_GET_FILE_CHUNK,
        type_arguments: [],
        arguments: [account, ownerAddr, String(capsuleId), String(i)] // Ensure both capsuleId and i are strings
      };

      const chunkData = await client.view(chunkPayload);

      // Handle chunk data based on its format
      let byteArray;
      if (typeof chunkData[0] === 'string') {
        // If chunkData[0] is a hex string (e.g., "0xffd8ffe0...")
        if (chunkData[0].startsWith('0x')) {
          const hexString = chunkData[0].slice(2); // Remove '0x' prefix
          byteArray = new Uint8Array(
            hexString.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
          );
        } else {
          // If it's a string of bytes encoded differently, decode it
          byteArray = new Uint8Array(new TextEncoder().encode(chunkData[0]));
        }
      } else if (Array.isArray(chunkData[0])) {
        // If chunkData[0] is an array of numbers (e.g., [255, 216, ...])
        byteArray = new Uint8Array(chunkData[0]);
      } else {
        throw new Error(`Unexpected chunk data format: ${typeof chunkData[0]}`);
      }

      allChunks.push(byteArray);

      // Small delay to prevent rate limiting
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Reconstruct the file
    const totalSize = allChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const reconstructedFile = new Uint8Array(totalSize);
    let offset = 0;
    
    for (const chunk of allChunks) {
      reconstructedFile.set(chunk, offset);
      offset += chunk.length;
    }

    // Create blob and URL
    const blob = new Blob([reconstructedFile], { type: mimeType });
    const url = URL.createObjectURL(blob);
    
    setImageUrl(url);
    setStatus(`✅ Image successfully retrieved! File size: ${(totalSize / 1024).toFixed(2)} KB`);
    setIsUnlocking(false);

  } catch (e) {
    setStatus(`❌ Failed to retrieve image: ${e?.message || e}`);
    console.error("Image retrieval error:", e);
    setIsUnlocking(false);
  }
}

  function closeImage() {
    if (imageUrl) {
      URL.revokeObjectURL(imageUrl);
      setImageUrl(null);
      setRetrievedCapsuleInfo(null);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-blue-50 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-blue-500 mb-2">Memora</h1>
          <p className="text-blue-600">Secure your files on the Aptos blockchain with chunked upload</p>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6 flex flex-col md:flex-row items-center justify-between">
          <div className="mb-4 md:mb-0">
            <h2 className="text-lg font-semibold text-gray-800">Wallet Status</h2>
            <p className={`text-sm ${account ? "text-green-600" : "text-gray-500"}`}>
              {account ? `Connected: ${account.slice(0, 6)}...${account.slice(-4)}` : "Not connected"}
            </p>
          </div>
          {!account ? (
            <button onClick={connectWallet} className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-blue-500 text-white rounded-lg shadow-md hover:shadow-lg transition-all duration-300 font-medium">
              Connect Petra Wallet
            </button>
          ) : (
            <div className="px-4 py-2 bg-green-100 text-green-800 rounded-full text-sm font-medium">Connected</div>
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
                  selected === m.id ? "border-indigo-500 bg-indigo-50 shadow-md ring-2 ring-indigo-200" : "border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300"
                }`}
              >
                <div className="font-semibold text-gray-800">{m.name}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {m.needsGeo && <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">Geo</span>}
                  {m.needsTime && <span className="px-2 py-1 bg-purple-100 text-purple-800 text-xs rounded-full">Time</span>}
                  {m.capsuleType === 2 && <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">Collaborative</span>}
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
              <label className="block text-sm font-medium text-gray-700">Image (any size - will be chunked automatically)</label>
              <div className="flex items-center space-x-4">
                <label className="flex-1">
                  <div className="flex flex-col items-center justify-center px-6 py-8 border-2 border-dashed border-gray-300 rounded-lg hover:border-indigo-500 transition-colors cursor-pointer">
                    <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="mt-2 text-sm text-gray-600">Click to upload image</span>
                    <span className="text-xs text-gray-500">Large files will be uploaded in chunks</span>
                    <input type="file" accept="image/*" onChange={onFileChange} className="hidden" />
                  </div>
                </label>
                {file && (
                  <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                    <div className="flex items-center text-green-700">
                      <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <div>
                        <div className="text-sm font-medium">{file.name}</div>
                        <div className="text-xs">{fileMimeType} - {(fileBytes.length / 1024).toFixed(2)} KB</div>
                        <div className="text-xs">Will upload in {Math.ceil(fileBytes.length / CHUNK_SIZE)} chunks</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Upload Progress Bar */}
            {isUploading && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Upload Progress</span>
                  <span>{uploadProgress.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-gradient-to-r from-indigo-600 to-blue-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
              </div>
            )}

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
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Longitude</label>
                    <input
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      placeholder="e.g. -122.4194"
                      value={geoLong}
                      onChange={(e) => setGeoLong(e.target.value)}
                      required
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
                  (!account || !fileBytes.length || isUploading) ? "opacity-50 cursor-not-allowed" : "hover:from-indigo-700 hover:to-blue-600"
                }`}
                disabled={!account || !fileBytes.length || isUploading}
              >
                {isUploading ? "Creating & Uploading..." : "Create Secure Capsule"}
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
                  disabled={isUnlocking}
                  className={`w-full py-2 px-4 bg-gradient-to-r from-purple-600 to-indigo-500 text-white font-medium rounded-lg shadow-md hover:shadow-lg hover:from-purple-700 hover:to-indigo-600 transition-all duration-300 ${
                    isUnlocking ? "opacity-50 cursor-not-allowed" : ""
                  }`}
                >
                  {isUnlocking ? "Unlocking..." : "Request Unlock"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Retrieved Capsule Info */}
        {retrievedCapsuleInfo && (
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">Capsule Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="font-medium text-gray-700">Capsule Type:</span>
                <span className="ml-2 text-gray-600">{retrievedCapsuleInfo.capsuleType}</span>
              </div>
              <div>
                <span className="font-medium text-gray-700">File Size:</span>
                <span className="ml-2 text-gray-600">{(retrievedCapsuleInfo.fileSize / 1024).toFixed(2)} KB</span>
              </div>
              <div>
                <span className="font-medium text-gray-700">Total Chunks:</span>
                <span className="ml-2 text-gray-600">{retrievedCapsuleInfo.totalChunks}</span>
              </div>
              <div>
                <span className="font-medium text-gray-700">Status:</span>
                <span className={`ml-2 px-2 py-1 rounded-full text-xs ${retrievedCapsuleInfo.isUnlocked ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                  {retrievedCapsuleInfo.isUnlocked ? 'Unlocked' : 'Locked'}
                </span>
              </div>
              <div>
                <span className="font-medium text-gray-700">Upload Complete:</span>
                <span className={`ml-2 px-2 py-1 rounded-full text-xs ${retrievedCapsuleInfo.isComplete ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                  {retrievedCapsuleInfo.isComplete ? 'Complete' : 'Pending'}
                </span>
              </div>
              <div>
                <span className="font-medium text-gray-700">Unlock Time:</span>
                <span className="ml-2 text-gray-600 text-xs">{retrievedCapsuleInfo.unlockTime}</span>
              </div>
            </div>
          </div>
        )}

        {/* Retrieved Image Display */}
        {imageUrl && (
          <div className="bg-white rounded-xl shadow-lg overflow-hidden">
            <div className="bg-gradient-to-r from-green-600 to-emerald-500 p-5 flex justify-between items-center">
              <h2 className="text-xl font-semibold text-white">🎉 Unlocked Image Retrieved!</h2>
              <button
                onClick={closeImage}
                className="px-4 py-2 bg-white bg-opacity-20 text-white rounded-lg hover:bg-opacity-30 transition-all duration-300 flex items-center"
              >
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Close
              </button>
            </div>
            <div className="p-6">
              <div className="text-center">
                <img 
                  src={imageUrl} 
                  alt="Unlocked Capsule Content" 
                  className="max-w-full max-h-96 mx-auto rounded-lg shadow-lg border border-gray-200"
                  onLoad={() => console.log("Image loaded successfully")}
                  onError={(e) => {
                    console.error("Image failed to load:", e);
                    setStatus("❌ Failed to display image");
                  }}
                />
                <div className="mt-4 p-4 bg-green-50 rounded-lg">
                  <p className="text-green-800 font-medium">✅ Your secured image has been successfully retrieved from the Aptos blockchain!</p>
                  <p className="text-green-700 text-sm mt-2">This image was stored securely using chunked upload and can only be accessed with the correct unlock conditions.</p>
                </div>
                <div className="mt-4 flex justify-center space-x-4">
                  <a
                    href={imageUrl}
                    download={`capsule-${enterCapsuleId}-image.png`}
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors duration-300 flex items-center"
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Download Image
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Status Display */}
        {status && (
          <div
            className={`p-4 rounded-lg ${
              status.startsWith("✅") ? "bg-green-50 text-green-800" : 
              status.startsWith("❌") ? "bg-red-50 text-red-800" : 
              "bg-blue-50 text-blue-800"
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

        {/* How It Works Guide */}
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">📚 Chunked Upload System</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-medium text-gray-700 mb-2 flex items-center">
                <svg className="w-5 h-5 mr-2 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                Creating Large File Capsules
              </h4>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• Files split into 50KB chunks automatically</li>
                <li>• Each chunk uploaded in separate transaction</li>
                <li>• No file size limits - upload any image</li>
                <li>• Progress tracking during upload</li>
                <li>• Automatic compression if needed</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-gray-700 mb-2 flex items-center">
                <svg className="w-5 h-5 mr-2 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m0 0a2 2 0 012 2m-2-2h-6m6 0v6a2 2 0 01-2 2H9a2 2 0 01-2-2V9a2 2 0 012-2h2m6 0V7a2 2 0 00-2-2H9a2 2 0 00-2 2v2m6 0V7" />
                </svg>
                Retrieving Chunked Files
              </h4>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• Download chunks sequentially</li>
                <li>• Reconstruct original file perfectly</li>
                <li>• Preserve image quality and format</li>
                <li>• Handle any file size efficiently</li>
                <li>• Verify upload completion status</li>
              </ul>
            </div>
          </div>
          <div className="mt-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
            <h4 className="font-medium text-blue-800 mb-2">🚀 Transaction Optimization</h4>
            <p className="text-blue-700 text-sm">
              The chunked upload system eliminates transaction size limits by splitting large files into 50KB pieces. 
              Each chunk is uploaded separately, allowing for images of any size while staying under Aptos transaction limits.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}