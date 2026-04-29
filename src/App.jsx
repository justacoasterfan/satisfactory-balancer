import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Trash2, Settings2, AlertCircle, Maximize2, Users, Link as LinkIcon, Check, Copy } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// --- FIREBASE INIT ---
const firebaseConfig = {
  apiKey: "AIzaSyAI6NbxUrcX7QnAzGhA372WM563zlb-UNs",
  authDomain: "load-balancer-calculator.firebaseapp.com",
  projectId: "load-balancer-calculator",
  storageBucket: "load-balancer-calculator.firebasestorage.app",
  messagingSenderId: "217274860489",
  appId: "1:217274860489:web:bd6a8389d553f64c8b9e18",
  measurementId: "G-9F8SG9443E"
};

let app, auth, db;
const appId = "satisfactory-balancer"; // Give your app a static ID

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (e) {
  console.error("Firebase init failed:", e);
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

const BELT_TIERS = [
  { level: 1, rate: 60, color: '#6b7280' },    // Mk.1
  { level: 2, rate: 120, color: '#3b82f6' },   // Mk.2
  { level: 3, rate: 270, color: '#eab308' },   // Mk.3
  { level: 4, rate: 480, color: '#10b981' },   // Mk.4
  { level: 5, rate: 780, color: '#8b5cf6' },   // Mk.5
  { level: 6, rate: 1200, color: '#ec4899' },  // Mk.6
];

// Fallback clipboard copy (handles iframe restrictions)
const copyToClipboard = (text) => {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text);
  } else {
    let textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    textArea.style.top = "-999999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try { document.execCommand('copy'); } catch (err) { console.error('Copy failed', err); }
    textArea.remove();
  }
};

// --- ALGORITHM CORE ---
function generateBalancer(inputs, outputs, maxTier) {
  let nodes = [];
  let edges = [];
  let idSeq = 1;
  const getId = (prefix) => `${prefix}_${idSeq++}`;

  const addNode = (type, rate, label) => {
    let id = getId(type);
    nodes.push({ id, type, rate, label, layer: 0, x: 0, y: 0 });
    return id;
  };
  const addEdge = (source, target, rate) => {
    edges.push({ id: getId('Edge'), source, target, rate });
  };

  // 1. Setup Phase
  let available = [];
  inputs.forEach((inp, idx) => {
    let id = addNode('Input', inp.rate, `In ${idx + 1}`);
    available.push({ source: id, rate: inp.rate });
  });

  let targets = outputs.map((out, idx) => ({
    id: addNode('Output', out.rate, `Out ${idx + 1}`),
    rate: out.rate,
    connected: 0,
    inputs: []
  }));

  // 2. Consolidation Phase
  let consolidated = true;
  while (consolidated) {
    consolidated = false;
    available.sort((a, b) => a.rate - b.rate);
    for (let i = 0; i < available.length - 1; i++) {
      if (available[i].rate + available[i + 1].rate <= maxTier) {
        let mergedRate = available[i].rate + available[i + 1].rate;
        let count = 2;
        if (i + 2 < available.length && mergedRate + available[i + 2].rate <= maxTier) {
          mergedRate += available[i + 2].rate;
          count = 3;
        }

        let mId = addNode('Merger', mergedRate, 'Merger');
        for (let j = 0; j < count; j++) {
          addEdge(available[i + j].source, mId, available[i + j].rate);
        }
        
        let newBelt = { source: mId, rate: mergedRate };
        available.splice(i, count, newBelt);
        consolidated = true;
        break;
      }
    }
  }

  // 3. Distribution Phase
  let safety = 0;
  while (available.length > 0 && targets.some(t => t.rate - t.connected > 0.001) && safety++ < 1000) {
    available.sort((a, b) => b.rate - a.rate);
    targets.sort((a, b) => (b.rate - b.connected) - (a.rate - a.connected));

    let target = targets.find(t => t.rate - t.connected > 0.001);
    if (!target) break;

    let rem = target.rate - target.connected;

    // Exact Match
    let exactIdx = available.findIndex(a => Math.abs(a.rate - rem) < 0.001);
    if (exactIdx !== -1) {
      let b = available.splice(exactIdx, 1)[0];
      target.inputs.push(b);
      target.connected += b.rate;
      continue;
    }

    let belt = available[0];

    // Split
    if (belt.rate > rem + 0.001) {
      available.shift();
      let sId = addNode('Splitter', belt.rate, 'Splitter');
      addEdge(belt.source, sId, belt.rate);

      let splitWays = 2;
      let p2 = belt.rate / 2;
      let p3 = belt.rate / 3;

      let hasExact2 = targets.some(t => Math.abs((t.rate - t.connected) - p2) < 0.001);
      let hasExact3 = targets.some(t => Math.abs((t.rate - t.connected) - p3) < 0.001);

      if (hasExact3 && !hasExact2) splitWays = 3;
      else if (hasExact2) splitWays = 2;
      else if (Math.abs(belt.rate % 3) < 0.001 && p3 >= targets[targets.length - 1].rate - targets[targets.length - 1].connected) splitWays = 3;

      let newRate = belt.rate / splitWays;
      for (let i = 0; i < splitWays; i++) {
        available.push({ source: sId, rate: newRate });
      }
    } 
    // Merge
    else {
      available.shift();
      target.inputs.push(belt);
      target.connected += belt.rate;
    }
  }

  // 4. Expansion Phase
  targets.forEach(t => {
    if (t.inputs.length === 1) {
      addEdge(t.inputs[0].source, t.id, t.inputs[0].rate);
    } else if (t.inputs.length > 1) {
      let currentInputs = [...t.inputs];
      while (currentInputs.length > 3) {
        currentInputs.sort((a, b) => a.rate - b.rate);
        let mergedRate = currentInputs[0].rate + currentInputs[1].rate + currentInputs[2].rate;
        let mId = addNode('Merger', mergedRate, 'Merger');
        for (let i = 0; i < 3; i++) {
          addEdge(currentInputs[i].source, mId, currentInputs[i].rate);
        }
        currentInputs.splice(0, 3, { source: mId, rate: mergedRate });
      }
      let finalMId = addNode('Merger', t.rate, 'Merger');
      currentInputs.forEach(inp => {
        addEdge(inp.source, finalMId, inp.rate);
      });
      addEdge(finalMId, t.id, t.rate);
    }
  });

  // 5. Layout Engine
  let changed = true;
  while (changed) {
    changed = false;
    edges.forEach(e => {
      let src = nodes.find(n => n.id === e.source);
      let tgt = nodes.find(n => n.id === e.target);
      if (src && tgt && tgt.type !== 'Output') {
        if (tgt.layer <= src.layer) {
          tgt.layer = src.layer + 1;
          changed = true;
        }
      }
    });
  }

  let maxLayer = nodes.length > 0 ? Math.max(...nodes.map(n => n.layer)) : 0;
  nodes.forEach(n => {
    if (n.type === 'Output') n.layer = maxLayer + 1;
  });

  let layerNodes = {};
  nodes.forEach(n => {
    if (!layerNodes[n.layer]) layerNodes[n.layer] = [];
    layerNodes[n.layer].push(n);
  });

  for (let pass = 0; pass < 3; pass++) {
    for (let l = 0; l <= maxLayer + 1; l++) {
      if (!layerNodes[l]) continue;
      layerNodes[l].forEach(n => {
        let parents = edges.filter(e => e.target === n.id).map(e => nodes.find(src => src.id === e.source));
        n.avgParentY = parents.length > 0 ? parents.reduce((sum, p) => sum + p.y, 0) / parents.length : (n.y || 0);
      });
      layerNodes[l].sort((a, b) => a.avgParentY - b.avgParentY);
      layerNodes[l].forEach((n, idx) => {
        n.y = (Math.max(800, layerNodes[l].length * 150) / (layerNodes[l].length + 1)) * (idx + 1);
      });
    }
  }

  Object.keys(layerNodes).forEach(l => {
    layerNodes[l].forEach(n => {
      n.x = 100 + parseInt(l) * 350;
    });
  });

  return { nodes, edges };
}

// --- UI COMPONENTS ---
export default function App() {
  const [inputs, setInputs] = useState([{ id: 1, rate: 120, count: 1 }]);
  const [outputs, setOutputs] = useState([{ id: 1, rate: 40, count: 3 }]);
  const [maxTier, setMaxTier] = useState(270);
  const [graph, setGraph] = useState({ nodes: [], edges: [] });
  const [nodeStates, setNodeStates] = useState({}); // { [nodeId]: { built: true, byName: 'Bob', byUid: '123' } }
  
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 50, y: 50 });
  const [isPanning, setIsPanning] = useState(false);
  const [draggingNodeId, setDraggingNodeId] = useState(null);

  // Multiplayer State
  const [user, setUser] = useState(null);
  const [userName, setUserName] = useState('');
  const [sessionId, setSessionId] = useState(new URLSearchParams(window.location.search).get('session') || null);
  const [copied, setCopied] = useState(false);

  // Firebase Auth Setup
  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth error", err);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // Firebase Realtime Sync
  useEffect(() => {
    if (!user || !db || !sessionId) return;
    
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'sessions', sessionId);
    const unsubscribe = onSnapshot(docRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        // Sync configuration silently
        if (data.inputs) setInputs(data.inputs);
        if (data.outputs) setOutputs(data.outputs);
        if (data.maxTier) setMaxTier(data.maxTier);
        if (data.nodeStates) setNodeStates(data.nodeStates);

        // Auto-generate graph to match server state
        if (data.inputs && data.outputs) {
           const flatInputs = data.inputs.flatMap(i => Array.from({ length: i.count || 1 }, () => ({ rate: i.rate })));
           const flatOutputs = data.outputs.flatMap(o => Array.from({ length: o.count || 1 }, () => ({ rate: o.rate })));
           setGraph(generateBalancer(flatInputs, flatOutputs, data.maxTier || 270));
        }
      }
    }, (err) => {
      console.error("Sync error", err);
      setError("Failed to sync session data.");
    });
    return () => unsubscribe();
  }, [user, sessionId]);

  const totalInput = inputs.reduce((sum, i) => sum + (i.rate * (i.count || 1)), 0);
  const totalOutput = outputs.reduce((sum, o) => sum + (o.rate * (o.count || 1)), 0);

  const handleGenerate = async () => {
    setError('');
    
    if (inputs.length === 0 || outputs.length === 0) {
      setError('You need at least one input and one output.');
      return;
    }
    
    if (Math.abs(totalInput - totalOutput) > 0.001) {
      setError(`Imbalanced! Total Input (${totalInput}) must equal Total Output (${totalOutput}).`);
      return;
    }

    if (inputs.some(i => i.rate > maxTier) || outputs.some(o => o.rate > maxTier)) {
      setError(`A single belt cannot exceed the Max Tier limit (${maxTier} items/min).`);
      return;
    }

    const flatInputs = inputs.flatMap(i => Array.from({ length: i.count || 1 }, () => ({ rate: i.rate })));
    const flatOutputs = outputs.flatMap(o => Array.from({ length: o.count || 1 }, () => ({ rate: o.rate })));

    setNodeStates({}); // Clear progress on structural change
    const newGraph = generateBalancer(flatInputs, flatOutputs, maxTier);
    setGraph(newGraph);
    setZoom(1);
    setPan({ x: 50, y: 50 });

    // Sync structural changes if in session
    if (sessionId && db && user) {
      try {
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'sessions', sessionId);
        await setDoc(docRef, { inputs, outputs, maxTier, nodeStates: {} }, { merge: true });
      } catch (err) {
        console.error("Failed to sync structural changes", err);
      }
    }
  };

  // Generate on initial load only if NOT in a session (if in session, sync listener does it)
  useEffect(() => {
    if (!sessionId) handleGenerate();
    // eslint-disable-next-line
  }, []);

  const addInput = () => setInputs([...inputs, { id: Date.now(), rate: 60, count: 1 }]);
  const removeInput = (id) => setInputs(inputs.filter(i => i.id !== id));
  const updateInput = (id, field, val) => setInputs(inputs.map(i => i.id === id ? { ...i, [field]: Number(val) } : i));

  const addOutput = () => setOutputs([...outputs, { id: Date.now(), rate: 60, count: 1 }]);
  const removeOutput = (id) => setOutputs(outputs.filter(o => o.id !== id));
  const updateOutput = (id, field, val) => setOutputs(outputs.map(o => o.id === id ? { ...o, [field]: Number(val) } : o));

  // Panning, Zoom & Drag Handlers
  const handleMouseDown = (e) => {
    if (e.button !== 0) return; 
    setIsPanning(true);
  };
  
  const handleMouseMove = (e) => {
    if (draggingNodeId) {
      setGraph(prev => ({
        ...prev,
        nodes: prev.nodes.map(n => n.id === draggingNodeId ? { ...n, x: n.x + e.movementX / zoom, y: n.y + e.movementY / zoom } : n)
      }));
    } else if (isPanning) {
      setPan(prev => ({ x: prev.x + e.movementX, y: prev.y + e.movementY }));
    }
  };
  
  const handleMouseUp = () => { setIsPanning(false); setDraggingNodeId(null); };

  const handleWheel = (e) => {
    if (e.deltaY < 0) setZoom(z => Math.min(3, z + 0.1));
    else setZoom(z => Math.max(0.1, z - 0.1));
  };

  const toggleNodeBuilt = async (id) => {
    const isCurrentlyBuilt = nodeStates[id]?.built;
    const newState = !isCurrentlyBuilt;
    
    const newStates = { ...nodeStates };
    if (newState) {
      newStates[id] = { built: true, byName: userName.trim() || 'Anonymous', byUid: user?.uid || 'local' };
    } else {
      delete newStates[id];
    }
    
    setNodeStates(newStates); // Optimistic

    if (sessionId && db && user) {
      try {
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'sessions', sessionId);
        await setDoc(docRef, { nodeStates: newStates }, { merge: true });
      } catch (err) {
        console.error("Failed to sync progress", err);
      }
    }
  };

  const startSession = async () => {
    if (!db || !user) { setError("Connecting to server, please wait..."); return; }
    
    const newSid = Math.random().toString(36).substring(2, 10);
    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'sessions', newSid);
      await setDoc(docRef, { inputs, outputs, maxTier, nodeStates });
      setSessionId(newSid);
      window.history.pushState({}, '', '?session=' + newSid);
    } catch (err) {
      setError("Failed to create session: " + err.message);
    }
  };

  const handleCopyLink = () => {
    copyToClipboard(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex h-screen bg-slate-900 text-slate-200 font-sans overflow-hidden">
      
      {/* Sidebar Controls */}
      <div className="w-80 bg-slate-800 border-r border-slate-700 flex flex-col h-full shadow-2xl z-10">
        <div className="p-5 border-b border-slate-700 bg-slate-800">
          <h1 className="text-xl font-bold text-orange-400 flex items-center gap-2">
            <Settings2 className="w-6 h-6" />
            Balancer Calculator
          </h1>
          <p className="text-xs text-slate-400 mt-1">Optimal, compact load balancers respecting belt capacities.</p>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          
          {/* Collaboration Panel */}
          <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700">
            <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-blue-400" />
              Multiplayer Sync
            </h2>
            
            <input 
              type="text" 
              placeholder="Your Display Name" 
              value={userName}
              onChange={e => setUserName(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-sm outline-none focus:border-blue-500 transition-colors mb-3"
            />

            {!sessionId ? (
              <button 
                onClick={startSession}
                className="w-full bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-500/30 text-sm font-semibold py-2 px-4 rounded transition-colors"
              >
                Start Shared Session
              </button>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between bg-green-900/30 border border-green-500/30 px-3 py-1.5 rounded">
                  <span className="text-xs text-green-400 font-semibold flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> Live Session</span>
                </div>
                <button 
                  onClick={handleCopyLink}
                  className="w-full bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm py-2 px-4 rounded transition-colors flex justify-center items-center gap-2"
                >
                  {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied Link!' : 'Copy Invite Link'}
                </button>
              </div>
            )}
          </div>

          {/* Max Tier Selector */}
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Maximum Belt Tier</label>
            <select 
              value={maxTier}
              onChange={(e) => setMaxTier(Number(e.target.value))}
              className="w-full bg-slate-700 border border-slate-600 rounded-md p-2 text-sm focus:ring-2 focus:ring-orange-500 outline-none transition-colors"
            >
              {BELT_TIERS.map(tier => (
                <option key={tier.level} value={tier.rate}>
                  Mk.{tier.level} ({tier.rate} items/min)
                </option>
              ))}
            </select>
          </div>

          <hr className="border-slate-700" />

          {/* Inputs */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-semibold text-slate-300">Inputs (Total: {totalInput.toFixed(1)})</label>
              <button onClick={addInput} className="text-orange-400 hover:text-orange-300 p-1 bg-slate-700 rounded transition-colors">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2">
              {inputs.map((inp, i) => (
                <div key={inp.id} className="flex gap-2 items-center">
                  <span className="bg-slate-700 px-2 py-1.5 rounded text-xs font-mono flex-shrink-0 flex items-center">In {i+1}</span>
                  <input 
                    type="number" min="0" step="any"
                    value={inp.rate} 
                    onChange={(e) => updateInput(inp.id, 'rate', e.target.value)}
                    className="w-20 bg-slate-900 border border-slate-600 rounded p-1.5 text-sm outline-none focus:border-orange-500 transition-colors"
                    title="Rate (items/min)"
                  />
                  <span className="text-slate-500 font-bold text-sm">×</span>
                  <input 
                    type="number" min="1" step="1"
                    value={inp.count || 1} 
                    onChange={(e) => updateInput(inp.id, 'count', e.target.value)}
                    className="w-16 bg-slate-900 border border-slate-600 rounded p-1.5 text-sm outline-none focus:border-orange-500 transition-colors"
                    title="Quantity"
                  />
                  <button onClick={() => removeInput(inp.id)} className="text-red-400 hover:bg-slate-700 p-1.5 rounded transition-colors ml-auto">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Outputs */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-semibold text-slate-300">Outputs (Total: {totalOutput.toFixed(1)})</label>
              <button onClick={addOutput} className="text-orange-400 hover:text-orange-300 p-1 bg-slate-700 rounded transition-colors">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2">
              {outputs.map((out, i) => (
                <div key={out.id} className="flex gap-2 items-center">
                  <span className="bg-slate-700 px-2 py-1.5 rounded text-xs font-mono flex-shrink-0 flex items-center">Out {i+1}</span>
                  <input 
                    type="number" min="0" step="any"
                    value={out.rate} 
                    onChange={(e) => updateOutput(out.id, 'rate', e.target.value)}
                    className="w-20 bg-slate-900 border border-slate-600 rounded p-1.5 text-sm outline-none focus:border-orange-500 transition-colors"
                    title="Rate (items/min)"
                  />
                  <span className="text-slate-500 font-bold text-sm">×</span>
                  <input 
                    type="number" min="1" step="1"
                    value={out.count || 1} 
                    onChange={(e) => updateOutput(out.id, 'count', e.target.value)}
                    className="w-16 bg-slate-900 border border-slate-600 rounded p-1.5 text-sm outline-none focus:border-orange-500 transition-colors"
                    title="Quantity"
                  />
                  <button onClick={() => removeOutput(out.id)} className="text-red-400 hover:bg-slate-700 p-1.5 rounded transition-colors ml-auto">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

        </div>

        <div className="p-5 border-t border-slate-700 bg-slate-800">
          {error && (
            <div className="mb-4 text-xs bg-red-900/50 border border-red-500/50 text-red-200 p-2 rounded flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          <button 
            onClick={handleGenerate}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-4 rounded shadow-lg transition-colors flex items-center justify-center gap-2"
          >
            {sessionId ? "Update & Sync Graph" : "Generate Graph"}
          </button>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div 
        className={`flex-1 relative bg-[#0f172a] overflow-hidden ${(isPanning || draggingNodeId) ? 'cursor-grabbing' : 'cursor-grab'}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        style={{
          backgroundImage: 'radial-gradient(#1e293b 1px, transparent 1px)',
          backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`
        }}
      >
        
        {/* Zoom Controls */}
        <div 
          className="fixed top-4 right-4 z-20 flex gap-2 bg-slate-800 p-1 rounded-lg border border-slate-700 shadow-xl cursor-default"
          onMouseDown={e => e.stopPropagation()}
          onWheel={e => e.stopPropagation()}
        >
           <button onClick={() => setZoom(z => Math.max(0.1, z - 0.1))} className="p-2 hover:bg-slate-700 rounded text-slate-300">-</button>
           <span className="px-3 py-2 text-sm font-mono flex items-center bg-slate-900 rounded min-w-[3.5rem] justify-center">{Math.round(zoom * 100)}%</span>
           <button onClick={() => setZoom(z => Math.min(3, z + 0.1))} className="p-2 hover:bg-slate-700 rounded text-slate-300">+</button>
           <button onClick={() => { setZoom(1); setPan({x: 50, y: 50}); }} className="p-2 hover:bg-slate-700 rounded text-slate-300 ml-2 border-l border-slate-600">
              <Maximize2 className="w-4 h-4" />
           </button>
        </div>

        <div className="w-full h-full">
          <svg width="100%" height="100%" className="overflow-visible">
            <defs>
              <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#475569" />
              </marker>
              <style>
                {`
                  @keyframes flow {
                    to { stroke-dashoffset: -20; }
                  }
                  .belt-anim {
                    animation: flow 0.8s linear infinite;
                  }
                `}
              </style>
            </defs>

            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              {/* Draw Edges */}
              {graph.edges.map(e => {
              const src = graph.nodes.find(n => n.id === e.source);
              const tgt = graph.nodes.find(n => n.id === e.target);
              if (!src || !tgt) return null;

              const x1 = src.x + 60;
              const y1 = src.y;
              const x2 = tgt.x - 60;
              const y2 = tgt.y;
              
              const cx = (x1 + x2) / 2;
              const pathStr = `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
              
              let edgeColor = BELT_TIERS.find(t => e.rate <= t.rate)?.color || BELT_TIERS[BELT_TIERS.length - 1].color;
              
              if (src.type === 'Splitter') {
                const outEdges = graph.edges.filter(ed => ed.source === src.id);
                outEdges.sort((a, b) => {
                  const tgtA = graph.nodes.find(n => n.id === a.target);
                  const tgtB = graph.nodes.find(n => n.id === b.target);
                  return (tgtA?.y || 0) - (tgtB?.y || 0);
                });
                const edgeIndex = outEdges.findIndex(ed => ed.id === e.id);
                const SPLITTER_COLORS = ['#38bdf8', '#a3e635', '#f472b6']; // Sky, Lime, Pink
                edgeColor = SPLITTER_COLORS[edgeIndex % SPLITTER_COLORS.length];
              }

              const isBuilt = nodeStates[tgt.id]?.built;

              return (
                <g key={e.id} opacity={isBuilt ? 0.25 : 1}>
                  <path d={pathStr} fill="none" stroke="#1e293b" strokeWidth="12" />
                  <path d={pathStr} fill="none" stroke={edgeColor} strokeWidth="4" strokeOpacity="0.4" />
                  <path 
                    d={pathStr} 
                    fill="none" 
                    stroke={edgeColor} 
                    strokeWidth="4" 
                    strokeDasharray="6 8"
                    className={isBuilt ? '' : 'belt-anim'}
                  />
                  <rect x={(x1+x2)/2 - 20} y={(y1+y2)/2 - 12} width="40" height="20" rx="4" fill="#1e293b" stroke="#334155" />
                  <text x={(x1+x2)/2} y={(y1+y2)/2 + 4} fill={isBuilt ? '#64748b' : '#cbd5e1'} fontSize="10" textAnchor="middle" fontWeight="bold">
                    {e.rate.toFixed(1).replace(/\.0$/, '')}
                  </text>
                </g>
              );
            })}

            {/* Draw Nodes */}
            {graph.nodes.map(n => {
              let fill, stroke, bg;
              if (n.type === 'Input') { fill = '#10b981'; stroke = '#047857'; bg = '#064e3b'; }
              else if (n.type === 'Output') { fill = '#3b82f6'; stroke = '#1d4ed8'; bg = '#1e3a8a'; }
              else if (n.type === 'Splitter') { fill = '#f97316'; stroke = '#c2410c'; bg = '#431407'; }
              else if (n.type === 'Merger') { fill = '#8b5cf6'; stroke = '#6d28d9'; bg = '#2e1065'; }

              const stateInfo = nodeStates[n.id] || {};
              const isBuilt = stateInfo.built;

              return (
                <g 
                  key={n.id} 
                  transform={`translate(${n.x}, ${n.y})`} 
                  className={draggingNodeId === n.id ? 'cursor-grabbing' : 'cursor-grab'}
                  onMouseDown={(e) => { e.stopPropagation(); setDraggingNodeId(n.id); }}
                  opacity={isBuilt ? 0.4 : 1}
                >
                  <rect x="-60" y="-30" width="120" height="60" rx="8" fill="#000" opacity="0.3" transform="translate(4, 4)" />
                  <rect x="-60" y="-30" width="120" height="60" rx="8" fill={bg} stroke={stroke} strokeWidth="2" />
                  
                  <rect x="-60" y="-30" width="120" height="15" rx="8" fill={fill} />
                  <rect x="-60" y="-20" width="120" height="5" fill={fill} />

                  <text x="0" y="-18" fill="#fff" fontSize="10" fontWeight="bold" textAnchor="middle" style={{textTransform: 'uppercase', letterSpacing: '1px'}}>
                    {n.type}
                  </text>

                  <text x="0" y="8" fill="#e2e8f0" fontSize="14" fontWeight="bold" textAnchor="middle">
                    {n.label}
                  </text>
                  <text x="0" y="22" fill="#94a3b8" fontSize="10" textAnchor="middle">
                    {n.rate.toFixed(1).replace(/\.0$/, '')} /m
                  </text>

                  {(n.type === 'Output' || n.type === 'Splitter' || n.type === 'Merger') && (
                    <circle cx="-60" cy="0" r="4" fill="#0f172a" stroke={stroke} strokeWidth="2" />
                  )}
                  {(n.type === 'Input' || n.type === 'Splitter' || n.type === 'Merger') && (
                    <circle cx="60" cy="0" r="4" fill="#0f172a" stroke={stroke} strokeWidth="2" />
                  )}

                  {/* Built Toggle & Author */}
                  <g 
                    transform="translate(40, -27)"
                    onMouseDown={(e) => { e.stopPropagation(); toggleNodeBuilt(n.id); }}
                    className="cursor-pointer hover:opacity-80"
                  >
                    <rect width="16" height="16" rx="4" fill={isBuilt ? '#10b981' : '#0f172a'} stroke={isBuilt ? '#047857' : 'rgba(255,255,255,0.3)'} strokeWidth="1" />
                    {isBuilt && <path d="M4 8 l3 3 l5 -5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
                  </g>
                  {isBuilt && stateInfo.byName && (
                    <text x="48" y="-32" fill="#38bdf8" fontSize="9" fontWeight="bold" textAnchor="end">
                      {stateInfo.byName}
                    </text>
                  )}
                </g>
              );
            })}
            </g>
          </svg>

          {graph.nodes.length === 0 && !error && (
             <div className="absolute text-slate-500 font-mono text-lg flex flex-col items-center gap-4 bg-slate-800/80 p-8 rounded-xl border border-slate-700 backdrop-blur-sm" style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)'}}>
                <Settings2 className="w-12 h-12 text-slate-600 animate-spin" style={{animationDuration: '3s'}} />
                {sessionId ? "Loading synced session..." : "Configure your belts and click Generate."}
             </div>
          )}
        </div>
      </div>
    </div>
  );
}