import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Trash2, Settings2, AlertCircle, Maximize2, Users, Link as LinkIcon, Check, Copy, Lock } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, updateDoc, onSnapshot, deleteField } from 'firebase/firestore';

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

// Initialize everything once
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = "satisfactory-balancer";

const BELT_TIERS = [
  { level: 1, rate: 60, color: '#6b7280' },    // Mk.1
  { level: 2, rate: 120, color: '#3b82f6' },   // Mk.2
  { level: 3, rate: 270, color: '#eab308' },   // Mk.3
  { level: 4, rate: 480, color: '#10b981' },   // Mk.4
  { level: 5, rate: 780, color: '#8b5cf6' },   // Mk.5
  { level: 6, rate: 1200, color: '#ec4899' },  // Mk.6
];

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
  const addEdge = (source, target, rate, isThrottle = false) => {
    edges.push({ id: getId('Edge'), source, target, rate, isThrottle });
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

  // 1.5 Exact Direct Match Phase
  for (let i = available.length - 1; i >= 0; i--) {
    let inp = available[i];
    let t = targets.find(t => t.connected === 0 && Math.abs(t.rate - inp.rate) < 0.001);
    if (t) {
      t.inputs.push({ ...inp, isThrottle: false });
      t.connected += inp.rate;
      available.splice(i, 1);
    }
  }

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

    // A. Exact Match Priority
    let exactIdx = available.findIndex(a => Math.abs(a.rate - rem) < 0.001);
    if (exactIdx !== -1) {
      let b = available.splice(exactIdx, 1)[0];
      target.inputs.push({ ...b, isThrottle: false });
      target.connected += b.rate;
      continue;
    }

    // B. Throttle / Manifold Match Priority
    let tierMatchMade = false;
    for (let i = 0; i < targets.length; i++) {
        let t = targets[i];
        let tRem = t.rate - t.connected;
        if (tRem < 0.001) continue;

        let matchingTier = BELT_TIERS.find(tier => Math.abs(tier.rate - tRem) < 0.001);
        if (matchingTier) {
            let bIdx = available.findIndex(a => a.rate > tRem + 0.001);
            if (bIdx !== -1) {
                let belt = available.splice(bIdx, 1)[0];
                let sId = addNode('Splitter', belt.rate, 'Splitter');
                addEdge(belt.source, sId, belt.rate);

                t.inputs.push({ source: sId, rate: tRem, isThrottle: true });
                t.connected += tRem;

                available.push({ source: sId, rate: belt.rate - tRem });
                tierMatchMade = true;
                break;
            }
        }
    }
    if (tierMatchMade) continue;

    // C. Standard Fractional Split
    let belt = available[0];

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
    else {
      available.shift();
      target.inputs.push({ ...belt, isThrottle: false });
      target.connected += belt.rate;
    }
  }

  // 4. Expansion Phase
  targets.forEach(t => {
    if (t.inputs.length === 1) {
      addEdge(t.inputs[0].source, t.id, t.inputs[0].rate, t.inputs[0].isThrottle);
    } else if (t.inputs.length > 1) {
      let currentInputs = [...t.inputs];
      while (currentInputs.length > 3) {
        currentInputs.sort((a, b) => a.rate - b.rate);
        let mergedRate = currentInputs[0].rate + currentInputs[1].rate + currentInputs[2].rate;
        let mId = addNode('Merger', mergedRate, 'Merger');
        for (let i = 0; i < 3; i++) {
          addEdge(currentInputs[i].source, mId, currentInputs[i].rate, currentInputs[i].isThrottle);
        }
        currentInputs.splice(0, 3, { source: mId, rate: mergedRate, isThrottle: false });
      }
      let finalMId = addNode('Merger', t.rate, 'Merger');
      currentInputs.forEach(inp => {
        addEdge(inp.source, finalMId, inp.rate, inp.isThrottle);
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

  // Initial temporary Y assignment to establish relative order
  Object.keys(layerNodes).forEach(l => {
    layerNodes[l].forEach((n, idx) => { n.y = idx * 250; });
  });

  // Sugiyama Barycenter Method for Crossing Reduction (Dual-sweep)
  for (let pass = 0; pass < 6; pass++) {
    // Forward sweep (Left to Right: sort by average Parent Y)
    for (let l = 1; l <= maxLayer + 1; l++) {
      if (!layerNodes[l]) continue;
      layerNodes[l].forEach(n => {
        let parents = edges.filter(e => e.target === n.id).map(e => nodes.find(src => src.id === e.source));
        n.barycenter = parents.length > 0 ? parents.reduce((sum, p) => sum + p.y, 0) / parents.length : n.y;
      });
      layerNodes[l].sort((a, b) => a.barycenter - b.barycenter);
      layerNodes[l].forEach((n, idx) => { n.y = idx * 250; });
    }
    
    // Backward sweep (Right to Left: sort by average Child Y)
    for (let l = maxLayer; l >= 0; l--) {
      if (!layerNodes[l]) continue;
      layerNodes[l].forEach(n => {
        let children = edges.filter(e => e.source === n.id).map(e => nodes.find(tgt => tgt.id === e.target));
        n.barycenter = children.length > 0 ? children.reduce((sum, c) => sum + c.y, 0) / children.length : n.y;
      });
      layerNodes[l].sort((a, b) => a.barycenter - b.barycenter);
      layerNodes[l].forEach((n, idx) => { n.y = idx * 250; });
    }
  }

  // Final visual Y expansion and spacing
  Object.keys(layerNodes).forEach(l => {
    layerNodes[l].forEach((n, idx) => {
      n.y = (Math.max(1200, layerNodes[l].length * 250) / (layerNodes[l].length + 1)) * (idx + 1);
    });
  });

  Object.keys(layerNodes).forEach(l => {
    layerNodes[l].forEach(n => {
      n.x = 100 + parseInt(l) * 350;
    });
  });

  return { nodes, edges };
}

// --- UI COMPONENTS ---
export default function App() {
  const [inputs, setInputs] = useState([{ id: 1, rate: 270, count: 1 }]);
  const [outputs, setOutputs] = useState([{ id: 1, rate: 60, count: 1 }, { id: 2, rate: 210, count: 1 }]);
  const [maxTier, setMaxTier] = useState(270);
  const [graph, setGraph] = useState({ nodes: [], edges: [] });
  const [nodeStates, setNodeStates] = useState({}); 
  const [hasChanges, setHasChanges] = useState(false); 
  
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 50, y: 50 });
  const [isPanning, setIsPanning] = useState(false);
  const [draggingNodeId, setDraggingNodeId] = useState(null);

  const [user, setUser] = useState(null);
  const [userName, setUserName] = useState('');
  const [sessionId, setSessionId] = useState(new URLSearchParams(window.location.search).get('session') || null);
  const [copied, setCopied] = useState(false);
  const [syncLayout, setSyncLayout] = useState(true);
  
  // Refs to prevent stale closures and infinite loop triggers
  const lastSyncRef = useRef(''); 
  const graphRef = useRef(graph);
  const draggingNodeRef = useRef(draggingNodeId);
  const syncLayoutRef = useRef(syncLayout);
  const latestLayoutRef = useRef(null);

  useEffect(() => { graphRef.current = graph; }, [graph]);
  useEffect(() => { draggingNodeRef.current = draggingNodeId; }, [draggingNodeId]);
  useEffect(() => { syncLayoutRef.current = syncLayout; }, [syncLayout]);

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

  useEffect(() => {
    if (!user || !db || !sessionId) return;
    
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'sessions', sessionId);
    const unsubscribe = onSnapshot(docRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.inputs) setInputs(data.inputs);
        if (data.outputs) setOutputs(data.outputs);
        if (data.maxTier) setMaxTier(data.maxTier);
        if (data.nodeStates) setNodeStates(data.nodeStates);
        else setNodeStates({});

        let currentGraph = graphRef.current;

        // ONLY regenerate layout if the core setup structure was modified (tracked via graphRev)
        if (data.graphRev && data.graphRev !== lastSyncRef.current) {
           lastSyncRef.current = data.graphRev;
           const flatInputs = (data.inputs || []).flatMap(i => Array.from({ length: i.count || 1 }, () => ({ rate: i.rate })));
           const flatOutputs = (data.outputs || []).flatMap(o => Array.from({ length: o.count || 1 }, () => ({ rate: o.rate })));
           currentGraph = generateBalancer(flatInputs, flatOutputs, data.maxTier || 270);
           setGraph(currentGraph);
           setHasChanges(false);
        }

        // Keep track of the latest synced layout, or properly clear it if the graph was completely regenerated
        if (data.layout) {
            latestLayoutRef.current = data.layout;
        } else {
            latestLayoutRef.current = null; 
        }

        // Always apply synced positions to ensure dragged layouts stay organized for everyone
        if (data.layout && currentGraph.nodes.length > 0 && syncLayoutRef.current) {
           setGraph(prev => {
               let changed = false;
               const nodesToUpdate = (currentGraph !== graphRef.current) ? currentGraph.nodes : prev.nodes;
               const updatedNodes = nodesToUpdate.map(n => {
                   const syncedPos = data.layout[n.id];
                   // Ignore layout syncs for a node if we are currently dragging it locally
                   if (syncedPos && n.id !== draggingNodeRef.current) {
                       if (Math.abs(syncedPos.x - n.x) > 0.1 || Math.abs(syncedPos.y - n.y) > 0.1) {
                           changed = true;
                           return { ...n, x: syncedPos.x, y: syncedPos.y };
                       }
                   }
                   return n;
               });
               
               if (currentGraph !== graphRef.current) return { ...currentGraph, nodes: updatedNodes };
               return changed ? { ...prev, nodes: updatedNodes } : prev;
           });
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
    if (inputs.length === 0 && outputs.length === 0) {
      setError('You need at least one input or output.');
      return;
    }

    let finalInputs = [...inputs];
    let finalOutputs = [...outputs];

    // Core Auto-Balancing Logic
    const tIn = finalInputs.reduce((sum, i) => sum + (i.rate * (i.count || 1)), 0);
    const tOut = finalOutputs.reduce((sum, o) => sum + (o.rate * (o.count || 1)), 0);

    if (tIn > tOut + 0.001) {
      let remainder = Math.round((tIn - tOut) * 1000) / 1000;
      while (remainder > 0.001) {
          let chunk = Math.min(remainder, maxTier);
          finalOutputs.push({ id: Date.now() + Math.random(), rate: chunk, count: 1 });
          remainder = Math.round((remainder - chunk) * 1000) / 1000;
      }
      setOutputs(finalOutputs);
    } else if (tOut > tIn + 0.001) {
      let remainder = Math.round((tOut - tIn) * 1000) / 1000;
      while (remainder > 0.001) {
          let chunk = Math.min(remainder, maxTier);
          finalInputs.push({ id: Date.now() + Math.random(), rate: chunk, count: 1 });
          remainder = Math.round((remainder - chunk) * 1000) / 1000;
      }
      setInputs(finalInputs);
    }

    if (finalInputs.some(i => i.rate > maxTier) || finalOutputs.some(o => o.rate > maxTier)) {
      setError(`A single belt cannot exceed the Max Tier limit (${maxTier} items/min).`);
      return;
    }

    const flatInputs = finalInputs.flatMap(i => Array.from({ length: i.count || 1 }, () => ({ rate: i.rate })));
    const flatOutputs = finalOutputs.flatMap(o => Array.from({ length: o.count || 1 }, () => ({ rate: o.rate })));

    const newRev = Date.now().toString();
    lastSyncRef.current = newRev;
    
    setNodeStates({});
    setHasChanges(false);
    const newGraph = generateBalancer(flatInputs, flatOutputs, maxTier);
    setGraph(newGraph);
    setZoom(1);
    setPan({ x: 50, y: 50 });

    if (sessionId && db && user) {
      try {
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'sessions', sessionId);
        // By replacing the entire document instead of merging, we ensure old layouts & deleted nodes are perfectly wiped across all connected clients.
        await setDoc(docRef, { 
            inputs: finalInputs, 
            outputs: finalOutputs, 
            maxTier, 
            nodeStates: {}, 
            graphRev: newRev 
        });
      } catch (err) {
        console.error("Failed to sync structural changes", err);
      }
    }
  };

  useEffect(() => {
    if (!sessionId) handleGenerate();
  }, []);

  // Apply server layout immediately if toggled back on
  useEffect(() => {
    if (syncLayout && latestLayoutRef.current && graphRef.current.nodes.length > 0) {
        setGraph(prev => {
           let changed = false;
           const updatedNodes = prev.nodes.map(n => {
               const syncedPos = latestLayoutRef.current[n.id];
               if (syncedPos && n.id !== draggingNodeRef.current) {
                   if (Math.abs(syncedPos.x - n.x) > 0.1 || Math.abs(syncedPos.y - n.y) > 0.1) {
                       changed = true;
                       return { ...n, x: syncedPos.x, y: syncedPos.y };
                   }
               }
               return n;
           });
           return changed ? { ...prev, nodes: updatedNodes } : prev;
       });
    }
  }, [syncLayout]);

  const edgeGroups = useMemo(() => {
    const groups = {};
    graph.edges.forEach(e => {
      const key = `${e.source}_${e.target}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    });
    return groups;
  }, [graph.edges]);

  const addInput = () => { setInputs([...inputs, { id: Date.now(), rate: 60, count: 1 }]); setHasChanges(true); };
  const removeInput = (id) => { setInputs(inputs.filter(i => i.id !== id)); setHasChanges(true); };
  const updateInput = (id, field, val) => { setInputs(inputs.map(i => i.id === id ? { ...i, [field]: Number(val) } : i)); setHasChanges(true); };

  const addOutput = () => { setOutputs([...outputs, { id: Date.now(), rate: 60, count: 1 }]); setHasChanges(true); };
  const removeOutput = (id) => { setOutputs(outputs.filter(o => o.id !== id)); setHasChanges(true); };
  const updateOutput = (id, field, val) => { setOutputs(outputs.map(o => o.id === id ? { ...o, [field]: Number(val) } : o)); setHasChanges(true); };

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
  
  const handleMouseUp = () => { 
    setIsPanning(false); 
    // Push the organized layout directly to Firebase so it stays formatted for everyone
    if (draggingNodeId && sessionId && db && user && syncLayout) {
        const draggedNode = graphRef.current.nodes.find(n => n.id === draggingNodeId);
        if (draggedNode) {
            const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'sessions', sessionId);
            setDoc(docRef, { layout: { [draggingNodeId]: { x: draggedNode.x, y: draggedNode.y } } }, { merge: true }).catch(e => console.error(e));
        }
    }
    setDraggingNodeId(null); 
  };

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
    
    setNodeStates(newStates); 
    
    if (sessionId && db && user) {
      try {
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'sessions', sessionId);
        // Use updateDoc with dot notation to safely target and delete nested fields
        await updateDoc(docRef, { 
            [`nodeStates.${id}`]: newState ? newStates[id] : deleteField() 
        });
      } catch (err) {
        console.error("Failed to sync progress", err);
      }
    }
  };

  const startSession = async () => {
    if (!db || !user) { setError("Connecting to server, please wait..."); return; }
    if (hasChanges) { 
      setError("Please click 'Generate Graph' to automatically balance and apply your unsaved changes before starting the session."); 
      return; 
    }
    const newSid = Math.random().toString(36).substring(2, 10);
    const newRev = lastSyncRef.current || Date.now().toString();
    lastSyncRef.current = newRev;

    // Capture the existing layout so any pre-session organization isn't lost
    const initialLayout = {};
    graphRef.current.nodes.forEach(n => {
        initialLayout[n.id] = { x: n.x, y: n.y };
    });

    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'sessions', newSid);
      await setDoc(docRef, { inputs, outputs, maxTier, nodeStates, graphRev: newRev, layout: initialLayout });
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
      <div className="w-80 bg-slate-800 border-r border-slate-700 flex flex-col h-full shadow-2xl z-10">
        <div className="p-5 border-b border-slate-700 bg-slate-800">
          <h1 className="text-xl font-bold text-orange-400 flex items-center gap-2">
            <Settings2 className="w-6 h-6" />
            Balancer Calculator
          </h1>
          <p className="text-xs text-slate-400 mt-1">Optimal, compact load balancers respecting belt capacities.</p>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
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
                
                <div className="flex items-center justify-between bg-slate-900 border border-slate-700 px-3 py-2 rounded">
                  <span className="text-xs text-slate-300 font-semibold">Shared Organization</span>
                  <button
                    onClick={() => setSyncLayout(!syncLayout)}
                    className={`w-8 h-4 rounded-full relative transition-colors focus:outline-none ${syncLayout ? 'bg-blue-500' : 'bg-slate-600'}`}
                    title={syncLayout ? "Layout is synced with everyone" : "Layout is personal and local"}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${syncLayout ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
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

          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Maximum Belt Tier</label>
            <select 
              value={maxTier}
              onChange={(e) => { setMaxTier(Number(e.target.value)); setHasChanges(true); }}
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

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-semibold text-slate-300">Inputs ({totalInput.toFixed(1)})</label>
              <button onClick={addInput} className="text-orange-400 hover:text-orange-300 p-1 bg-slate-700 rounded transition-colors">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2">
              {inputs.map((inp, i) => (
                <div key={inp.id} className="flex gap-2 items-center">
                  <span className="bg-slate-700 px-2 py-1.5 rounded text-xs font-mono flex-shrink-0 flex items-center">In {i+1}</span>
                  <input type="number" step="any" value={inp.rate} onChange={(e) => updateInput(inp.id, 'rate', e.target.value)} className="w-20 bg-slate-900 border border-slate-600 rounded p-1.5 text-sm outline-none focus:border-orange-500 transition-colors" />
                  <span className="text-slate-500 font-bold text-sm">×</span>
                  <input type="number" min="1" value={inp.count || 1} onChange={(e) => updateInput(inp.id, 'count', e.target.value)} className="w-16 bg-slate-900 border border-slate-600 rounded p-1.5 text-sm outline-none focus:border-orange-500 transition-colors" />
                  <button onClick={() => removeInput(inp.id)} className="text-red-400 hover:bg-slate-700 p-1.5 rounded transition-colors ml-auto"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-semibold text-slate-300">Outputs ({totalOutput.toFixed(1)})</label>
              <button onClick={addOutput} className="text-orange-400 hover:text-orange-300 p-1 bg-slate-700 rounded transition-colors">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2">
              {outputs.map((out, i) => (
                <div key={out.id} className="flex gap-2 items-center">
                  <span className="bg-slate-700 px-2 py-1.5 rounded text-xs font-mono flex-shrink-0 flex items-center">Out {i+1}</span>
                  <input type="number" step="any" value={out.rate} onChange={(e) => updateOutput(out.id, 'rate', e.target.value)} className="w-20 bg-slate-900 border border-slate-600 rounded p-1.5 text-sm outline-none focus:border-orange-500 transition-colors" />
                  <span className="text-slate-500 font-bold text-sm">×</span>
                  <input type="number" min="1" value={out.count || 1} onChange={(e) => updateOutput(out.id, 'count', e.target.value)} className="w-16 bg-slate-900 border border-slate-600 rounded p-1.5 text-sm outline-none focus:border-orange-500 transition-colors" />
                  <button onClick={() => removeOutput(out.id)} className="text-red-400 hover:bg-slate-700 p-1.5 rounded transition-colors ml-auto"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-5 border-t border-slate-700 bg-slate-800">
          {error && <div className="mb-4 text-xs bg-red-900/50 border border-red-500/50 text-red-200 p-2 rounded flex items-start gap-2"><AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{error}</span></div>}
          <button onClick={handleGenerate} className={`w-full text-white font-bold py-2 px-4 rounded shadow-lg transition-colors flex items-center justify-center gap-2 ${hasChanges ? 'bg-orange-600 hover:bg-orange-500 animate-pulse' : 'bg-orange-500 hover:bg-orange-600'}`}>
            {sessionId ? "Update & Sync Graph" : "Generate Graph"}
          </button>
        </div>
      </div>

      <div 
        className={`flex-1 relative bg-[#0f172a] overflow-hidden ${(isPanning || draggingNodeId) ? 'cursor-grabbing' : 'cursor-grab'}`}
        onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} onWheel={handleWheel}
        style={{ backgroundImage: 'radial-gradient(#1e293b 1px, transparent 1px)', backgroundSize: `${20 * zoom}px ${20 * zoom}px`, backgroundPosition: `${pan.x}px ${pan.y}px` }}
      >
        <div className="fixed top-4 right-4 z-20 flex gap-2 bg-slate-800 p-1 rounded-lg border border-slate-700 shadow-xl cursor-default" onMouseDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
           <button onClick={() => setZoom(z => Math.max(0.1, z - 0.1))} className="p-2 hover:bg-slate-700 rounded text-slate-300">-</button>
           <span className="px-3 py-2 text-sm font-mono flex items-center bg-slate-900 rounded min-w-[3.5rem] justify-center">{Math.round(zoom * 100)}%</span>
           <button onClick={() => setZoom(z => Math.min(3, z + 0.1))} className="p-2 hover:bg-slate-700 rounded text-slate-300">+</button>
           <button onClick={() => { setZoom(1); setPan({x: 50, y: 50}); }} className="p-2 hover:bg-slate-700 rounded text-slate-300 ml-2 border-l border-slate-600"><Maximize2 className="w-4 h-4" /></button>
        </div>

        <div className="w-full h-full">
          <svg width="100%" height="100%" className="overflow-visible">
            <defs>
              <style>{`@keyframes flow { to { stroke-dashoffset: -20; } } .belt-anim { animation: flow 0.8s linear infinite; }`}</style>
            </defs>

            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              {graph.edges.map(e => {
                const src = graph.nodes.find(n => n.id === e.source);
                const tgt = graph.nodes.find(n => n.id === e.target);
                if (!src || !tgt) return null;

                const key = `${e.source}_${e.target}`;
                const group = edgeGroups[key];
                const indexInGroup = group.findIndex(ed => ed.id === e.id);
                const totalInGroup = group.length;

                const x1 = src.x + 60; const y1 = src.y;
                const x2 = tgt.x - 60; const y2 = tgt.y;
                const offset = totalInGroup > 1 ? (indexInGroup - (totalInGroup - 1) / 2) * 45 : 0;
                
                const midX = (x1 + x2) / 2; const midY = (y1 + y2) / 2 + offset;
                const pathStr = `M ${x1} ${y1} C ${midX} ${y1 + offset * 1.5}, ${midX} ${y2 + offset * 1.5}, ${x2} ${y2}`;
                
                let edgeColor = BELT_TIERS.find(t => e.rate <= t.rate)?.color || '#ec4899';
                if (src.type === 'Splitter' && !e.isThrottle) {
                    const outEdges = graph.edges.filter(ed => ed.source === src.id && !ed.isThrottle);
                    outEdges.sort((a, b) => (graph.nodes.find(n => n.id === a.target)?.y || 0) - (graph.nodes.find(n => n.id === b.target)?.y || 0));
                    const edgeIndex = outEdges.findIndex(ed => ed.id === e.id);
                    edgeColor = ['#38bdf8', '#a3e635', '#f472b6'][edgeIndex % 3];
                }

                const isBuilt = nodeStates[tgt.id]?.built;

                return (
                  <g key={e.id} opacity={isBuilt ? 0.25 : 1}>
                    <path d={pathStr} fill="none" stroke="#1e293b" strokeWidth="12" />
                    <path d={pathStr} fill="none" stroke={edgeColor} strokeWidth="4" strokeOpacity="0.4" />
                    <path d={pathStr} fill="none" stroke={edgeColor} strokeWidth="4" strokeDasharray="6 8" className={isBuilt ? '' : 'belt-anim'} />
                    
                    {/* Rate Label Box */}
                    <g transform={`translate(${midX}, ${midY})`}>
                      <rect x="-35" y="-12" width="70" height="24" rx="4" fill={e.isThrottle ? '#78350f' : '#1e293b'} stroke={e.isThrottle ? '#eab308' : '#334155'} strokeWidth="1.5" />
                      <text x="0" y="4" fill={isBuilt ? '#64748b' : '#cbd5e1'} fontSize="10" textAnchor="middle" fontWeight="bold">
                        {e.rate.toFixed(1).replace(/\.0$/, '')} {e.isThrottle && 'LIMIT'}
                      </text>
                      {e.isThrottle && (
                        <g transform="translate(-48, -8) scale(0.6)">
                           <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="#eab308" opacity="0.3" />
                           <rect x="7" y="11" width="10" height="8" rx="2" fill="#eab308" />
                           <path d="M9 11V8a3 3 0 0 1 6 0v3" fill="none" stroke="#eab308" strokeWidth="2" />
                        </g>
                      )}
                    </g>
                  </g>
                );
              })}

              {graph.nodes.map(n => {
                let fill, stroke, bg;
                if (n.type === 'Input') { fill = '#10b981'; stroke = '#047857'; bg = '#064e3b'; }
                else if (n.type === 'Output') { fill = '#3b82f6'; stroke = '#1d4ed8'; bg = '#1e3a8a'; }
                else if (n.type === 'Splitter') { fill = '#f97316'; stroke = '#c2410c'; bg = '#431407'; }
                else if (n.type === 'Merger') { fill = '#8b5cf6'; stroke = '#6d28d9'; bg = '#2e1065'; }

                const stateInfo = nodeStates[n.id] || {};
                const isBuilt = stateInfo.built;

                return (
                  <g key={n.id} transform={`translate(${n.x}, ${n.y})`} className={draggingNodeId === n.id ? 'cursor-grabbing' : 'cursor-grab'} onMouseDown={(e) => { e.stopPropagation(); setDraggingNodeId(n.id); }} opacity={isBuilt ? 0.4 : 1}>
                    <rect x="-60" y="-30" width="120" height="60" rx="8" fill="#000" opacity="0.3" transform="translate(4, 4)" />
                    <rect x="-60" y="-30" width="120" height="60" rx="8" fill={bg} stroke={stroke} strokeWidth="2" />
                    <rect x="-60" y="-30" width="120" height="15" rx="8" fill={fill} />
                    <rect x="-60" y="-20" width="120" height="5" fill={fill} />
                    <text x="0" y="-18" fill="#fff" fontSize="10" fontWeight="bold" textAnchor="middle" style={{textTransform: 'uppercase', letterSpacing: '1px'}}>{n.type}</text>
                    <text x="0" y="8" fill="#e2e8f0" fontSize="14" fontWeight="bold" textAnchor="middle">{n.label}</text>
                    <text x="0" y="22" fill="#94a3b8" fontSize="10" textAnchor="middle">{n.rate.toFixed(1).replace(/\.0$/, '')} /m</text>
                    {(n.type === 'Output' || n.type === 'Splitter' || n.type === 'Merger') && <circle cx="-60" cy="0" r="4" fill="#0f172a" stroke={stroke} strokeWidth="2" />}
                    {(n.type === 'Input' || n.type === 'Splitter' || n.type === 'Merger') && <circle cx="60" cy="0" r="4" fill="#0f172a" stroke={stroke} strokeWidth="2" />}
                    <g transform="translate(40, -27)" onMouseDown={(e) => { e.stopPropagation(); toggleNodeBuilt(n.id); }} className="cursor-pointer hover:opacity-80">
                      <rect width="16" height="16" rx="4" fill={isBuilt ? '#10b981' : '#0f172a'} stroke={isBuilt ? '#047857' : 'rgba(255,255,255,0.3)'} strokeWidth="1" />
                      {isBuilt && <path d="M4 8 l3 3 l5 -5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
                    </g>
                    {isBuilt && stateInfo.byName && <text x="48" y="-32" fill="#38bdf8" fontSize="9" fontWeight="bold" textAnchor="end">{stateInfo.byName}</text>}
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