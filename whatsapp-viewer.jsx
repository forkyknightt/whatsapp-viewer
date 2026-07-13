import { useState, useRef, useEffect, useMemo } from "react";

const parseWorker = typeof window !== "undefined" && window.Worker
  ? new Worker(new URL("./src/workers/parseChat.worker.js", import.meta.url), { type: "module" })
  : null;

function parseChat(text) {
  const lines = text.split("\n");
  const messages = [];
  const IOS_MSG = /^\[(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)\]\s+([^:]+):\s*([\s\S]*)/;
  const ANDROID_MSG = /^(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4}),\s*(\d{1,2}:\d{2}(?:\s*[AaPp][Mm])?)\s*-\s*([^:]+):\s*([\s\S]*)/;
  const IOS_SYS = /^\[(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)\]\s+([\s\S]+)/;
  const ANDROID_SYS = /^(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4}),\s*(\d{1,2}:\d{2}(?:\s*[AaPp][Mm])?)\s*-\s*([\s\S]+)/;
  let cur = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const im = line.match(IOS_MSG);
    const am = line.match(ANDROID_MSG);
    if (im || am) {
      if (cur) messages.push(cur);
      const m = im || am;
      const txt = m[4].trim();
      const mediaKw = ["<media omitted>", "image omitted", "video omitted", "audio omitted", "document omitted", "sticker omitted", "gif omitted", "photo omitted"];
      cur = {
        id: messages.length,
        dateStr: m[1],
        timeStr: m[2].trim(),
        sender: m[3].trim(),
        text: txt,
        isMedia: mediaKw.some(k => txt.toLowerCase().includes(k)),
        isDeleted: txt === "This message was deleted" || txt === "You deleted this message",
        isSystem: false,
      };
    } else {
      const is = line.match(IOS_SYS);
      const as_ = line.match(ANDROID_SYS);
      if (is || as_) {
        if (cur) {
          messages.push(cur);
          cur = null;
        }
        const m = is || as_;
        messages.push({
          id: messages.length,
          dateStr: m[1],
          timeStr: m[2].trim(),
          sender: null,
          text: m[3].trim(),
          isMedia: false,
          isDeleted: false,
          isSystem: true,
        });
      } else if (cur) {
        cur.text += "\n" + line;
      }
    }
  }

  if (cur) messages.push(cur);

  return messages.map(msg => {
    let dateObj = null;
    if (msg.dateStr) {
      const parts = msg.dateStr.split(/[\/\.\-]/);
      if (parts.length === 3) {
        let [d, mo, y] = parts;
        if (y.length === 2) y = "20" + y;
        dateObj = new Date(+y, +mo - 1, +d);
      }
    }
    return { ...msg, dateObj };
  });
}

function getDateLabel(dateObj) {
  if (!dateObj || isNaN(dateObj)) return "";
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (dateObj.toDateString() === today.toDateString()) return "Today";
  if (dateObj.toDateString() === yesterday.toDateString()) return "Yesterday";
  return dateObj.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function getMediaIcon(text) {
  const t = text.toLowerCase();
  if (t.includes("image") || t.includes("photo")) return "🖼️";
  if (t.includes("video")) return "🎬";
  if (t.includes("audio") || t.includes("voice")) return "🎵";
  if (t.includes("document")) return "📄";
  if (t.includes("sticker")) return "✨";
  if (t.includes("gif")) return "🎭";
  return "📎";
}

function groupItems(messages) {
  const items = [];
  let lastDate = null;
  messages.forEach(msg => {
    const lbl = getDateLabel(msg.dateObj);
    if (lbl && lbl !== lastDate) {
      lastDate = lbl;
      items.push({ type: "date", label: lbl, key: "d-" + msg.id });
    }
    items.push({ type: "msg", ...msg, key: "m-" + msg.id });
  });
  return items;
}

function Highlight({ text, query, matchId, isActive }) {
  if (!query) return <span>{text}</span>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return (
    <span>
      {parts.map((p, i) =>
        p.toLowerCase() === query.toLowerCase()
          ? <mark
              key={i}
              data-search-match-id={isActive ? matchId : undefined}
              style={{ background: "#ffd700", color: "#000", borderRadius: 2 }}
            >
              {p}
            </mark>
          : p
      )}
    </span>
  );
}

const WA_BG = `url("data:image/svg+xml,%3Csvg width='52' height='52' viewBox='0 0 52 52' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23182229' fill-opacity='0.6'%3E%3Cpath d='M26 0l2.6 4.5H23.4L26 0zm0 52l-2.6-4.5h5.2L26 52zM0 26l4.5-2.6v5.2L0 26zm52 0l-4.5 2.6v-5.2L52 26zM7.7 7.7l3.2 1.8-1.8 3.2-3.2-1.8 1.8-3.2zm36.6 36.6l-3.2-1.8 1.8-3.2 3.2 1.8-1.8 3.2zM7.7 44.3l1.8-3.2 3.2 1.8-1.8 3.2-3.2-1.8zm36.6-36.6l-1.8 3.2-3.2-1.8 1.8-3.2 3.2 1.8z'/%3E%3C/g%3E%3C/svg%3E")`;

export default function App() {
  const [stage, setStage] = useState("upload");
  const [messages, setMessages] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [myName, setMyName] = useState("");
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [searchIdx, setSearchIdx] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [isParsing, setIsParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState(0);
  const [visibleStart, setVisibleStart] = useState(0);
  const chatRef = useRef(null);
  const fileRef = useRef(null);
  const searchRef = useRef(null);
  const frameRef = useRef(null);
  const searchJumpRef = useRef(null);

  const otherName = useMemo(() => participants.find(p => p !== myName) || "Contact", [participants, myName]);

  const allItems = useMemo(() => groupItems(messages), [messages]);
  const viewportSize = 90;
  const overscan = 20;
  const itemHeight = 56;
  const visibleItems = useMemo(() => {
    const start = Math.max(0, visibleStart - overscan);
    const end = Math.min(allItems.length, visibleStart + viewportSize + overscan);
    return allItems.slice(start, end);
  }, [allItems, overscan, visibleStart, viewportSize]);

  const searchMatchItems = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return allItems.reduce((acc, item, index) => {
      if (item.type === "msg" && !item.isSystem && item.text?.toLowerCase().includes(q)) {
        acc.push({ id: item.id, index });
      }
      return acc;
    }, []);
  }, [search, allItems]);

  const searchMatches = useMemo(() => searchMatchItems.map(item => item.id), [searchMatchItems]);
  const currentMatch = searchMatchItems[Math.min(searchIdx, Math.max(0, searchMatchItems.length - 1))] || null;

  useEffect(() => {
    if (!currentMatch || !chatRef.current) return;

    if (searchJumpRef.current) window.clearTimeout(searchJumpRef.current);

    const targetTop = Math.max(0, currentMatch.index * itemHeight - 90);
    chatRef.current.scrollTop = targetTop;
    setVisibleStart(Math.max(0, Math.floor(targetTop / itemHeight)));

    searchJumpRef.current = window.setTimeout(() => {
      const activeEl = document.querySelector(`[data-search-match-id="${currentMatch.id}"]`);
      if (!activeEl || !chatRef.current) return;

      const containerTop = chatRef.current.getBoundingClientRect().top;
      const elementTop = activeEl.getBoundingClientRect().top;
      const delta = elementTop - containerTop - 90;
      chatRef.current.scrollTop = Math.max(0, chatRef.current.scrollTop + delta);
    }, 40);

    return () => {
      if (searchJumpRef.current) window.clearTimeout(searchJumpRef.current);
    };
  }, [currentMatch, itemHeight]);

  useEffect(() => {
    if (showSearch && searchRef.current) searchRef.current.focus();
  }, [showSearch]);

  useEffect(() => {
    if (!parseWorker) return;
    const handleMessage = event => {
      if (event.data?.type === "progress") {
        setParseProgress(event.data.total ? Math.round((event.data.processed / event.data.total) * 100) : 0);
        return;
      }
      if (event.data?.type !== "parsed") return;
      const parsed = event.data.parsed;
      const senders = [...new Set(parsed.filter(m => !m.isSystem && m.sender).map(m => m.sender))];
      setMessages(parsed);
      setParticipants(senders);
      setMyName(senders[senders.length - 1] || "");
      setStage(senders.length > 1 ? "select" : "chat");
      setIsParsing(false);
      setParseProgress(100);
    };
    parseWorker.addEventListener("message", handleMessage);
    return () => parseWorker.removeEventListener("message", handleMessage);
  }, []);

  const handleFile = file => {
    if (!file) return;
    setIsParsing(true);
    setParseProgress(0);
    setMessages([]);
    setParticipants([]);
    setMyName("");
    setStage("upload");
    const reader = new FileReader();
    reader.onload = e => {
      if (parseWorker) {
        parseWorker.postMessage({ type: "parse", text: e.target.result });
      } else {
        const parsed = parseChat(e.target.result);
        const senders = [...new Set(parsed.filter(m => !m.isSystem && m.sender).map(m => m.sender))];
        setMessages(parsed);
        setParticipants(senders);
        setMyName(senders[senders.length - 1] || "");
        setStage(senders.length > 1 ? "select" : "chat");
        setIsParsing(false);
        setParseProgress(100);
      }
    };
    reader.readAsText(file, "utf-8");
  };

  const handleScroll = () => {
    const el = chatRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60);

    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const top = el.scrollTop;
      setVisibleStart(Math.max(0, Math.floor(top / itemHeight)));
    });
  };

  useEffect(() => {
    if (stage === "chat") {
      setTimeout(() => {
        if (chatRef.current) { chatRef.current.scrollTop = chatRef.current.scrollHeight; setAtBottom(true); setVisibleStart(Math.max(0, allItems.length - 1)); }
      }, 80);
    }
  }, [stage, allItems.length]);

  const stats = useMemo(() => {
    const msgs = messages.filter(m => !m.isSystem);
    return {
      total: msgs.length,
      mine: msgs.filter(m => m.sender === myName).length,
      theirs: msgs.filter(m => m.sender !== myName).length,
      media: msgs.filter(m => m.isMedia).length,
    };
  }, [messages, myName]);

  const S = {
    root: { fontFamily: "'Segoe UI', system-ui, sans-serif", borderRadius: 16, overflow: "hidden" },
    screen: { minHeight: 520, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#111b21", padding: 40 },
  };

  if (stage === "upload") return (
    <div className="app-shell app-screen" style={{ ...S.root, ...S.screen }}>
      <h2 className="sr-only">Pollu's Chat Viewer — upload screen</h2>
      <div style={{ width: 80, height: 80, borderRadius: "50%", background: "linear-gradient(135deg,#25d366,#00a884)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20, boxShadow: "0 8px 32px rgba(0,168,132,0.35)" }}>
        <svg viewBox="0 0 24 24" width="40" height="40" fill="white"><path d="M17.498 14.382c-.301-.15-1.767-.867-2.04-.966-.273-.101-.473-.15-.673.15-.2.301-.767.966-.94 1.164-.173.199-.347.223-.647.075-.3-.15-1.269-.467-2.416-1.483-.893-.795-1.494-1.77-1.669-2.072-.174-.3-.019-.465.13-.615.134-.135.3-.348.45-.522.15-.174.2-.3.3-.498.099-.2.05-.374-.025-.524-.075-.15-.672-1.62-.922-2.206-.24-.574-.486-.497-.673-.51-.172-.007-.371-.01-.571-.01-.2 0-.523.074-.797.372-.273.3-1.045 1.02-1.045 2.488s1.07 2.887 1.22 3.086c.15.198 2.095 3.2 5.076 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.29.173-1.413-.074-.124-.273-.198-.571-.348z"/><path d="M20.52 3.449C12.831-3.984.106 1.407.101 11.893c0 2.096.549 4.14 1.595 5.945L0 24l6.335-1.652C15.808 27.208 24 20.317 24 11.877c0-3.19-1.24-6.19-3.48-8.428zM12 21.785c-1.787 0-3.54-.48-5.073-1.388l-.364-.214-3.762.988.998-3.648-.239-.375C.506 15.124.101 13.538.101 11.893c0-9.39 10.793-14.897 18.15-8.24 2.84 2.596 4.432 6.165 4.432 9.893 0 7.127-5.893 12.24-12.682 12.24z"/></svg>
      </div>
      <h1 style={{ color: "#e9edef", fontSize: 22, fontWeight: 600, margin: "0 0 8px" }}>Pollu's Chat Viewer</h1>
      <p style={{ color: "#8696a0", fontSize: 14, margin: "0 0 32px", textAlign: "center" }}>Upload your exported .txt file to relive your chats</p>

      <div
        className="upload-dropzone"
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={e => { e.preventDefault(); setIsDragging(false); handleFile(e.dataTransfer.files[0]); }}
        onClick={() => fileRef.current?.click()}
        style={{
          width: "100%", maxWidth: 380, border: `2px dashed ${isDragging ? "#00a884" : "#2a3942"}`,
          borderRadius: 16, padding: "36px 24px", textAlign: "center", cursor: "pointer",
          background: isDragging ? "rgba(0,168,132,0.1)" : "rgba(255,255,255,0.03)", transition: "all 0.2s",
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 12 }}>📁</div>
        <p style={{ color: "#e9edef", fontSize: 15, margin: "0 0 6px" }}>Drop your exported chat here</p>
        <p style={{ color: "#8696a0", fontSize: 13, margin: "0 0 20px" }}>or click to browse</p>
        <div style={{ background: "#00a884", color: "#fff", borderRadius: 24, padding: "10px 28px", display: "inline-block", fontSize: 14, fontWeight: 600 }}>Choose .txt file</div>
      </div>
      <input ref={fileRef} type="file" accept=".txt" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
      {isParsing && (
        <div style={{ marginTop: 18, width: "100%", maxWidth: 380 }}>
          <div style={{ color: "#00a884", fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Preparing your chat…</div>
          <div style={{ width: "100%", height: 8, borderRadius: 999, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
            <div style={{ width: `${parseProgress}%`, height: "100%", background: "linear-gradient(90deg,#25d366,#00a884)", transition: "width 0.2s ease" }} />
          </div>
        </div>
      )}

      <div style={{ marginTop: 28, background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: "14px 20px", maxWidth: 380, width: "100%" }}>
        <p style={{ color: "#8696a0", fontSize: 12, margin: 0, lineHeight: 1.6 }}>
          <strong style={{ color: "#e9edef" }}>How to export:</strong> Open WhatsApp → Open any chat → ⋮ → More → Export chat → Without media
        </p>
      </div>
    </div>
  );

  if (stage === "select") return (
    <div className="app-shell app-screen" style={{ ...S.root, ...S.screen }}>
      <h2 className="sr-only">Select your name from chat participants</h2>
      <div style={{ width: 60, height: 60, borderRadius: "50%", background: "#00a884", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20, fontSize: 28 }}>👤</div>
      <h2 style={{ color: "#e9edef", fontSize: 20, fontWeight: 600, margin: "0 0 8px" }}>Which one are you?</h2>
      <p style={{ color: "#8696a0", fontSize: 14, margin: "0 0 28px", textAlign: "center" }}>Your messages will appear on the right in green</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", maxWidth: 340 }}>
        {participants.map(p => (
          <button key={p} onClick={() => { setMyName(p); setStage("chat"); }}
            style={{ background: myName === p ? "#00a884" : "rgba(255,255,255,0.05)", border: `1px solid ${myName === p ? "#00a884" : "#2a3942"}`, borderRadius: 12, padding: "13px 18px", color: myName === p ? "#fff" : "#e9edef", fontSize: 15, fontWeight: 500, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 12, transition: "all 0.15s" }}>
            <div style={{ width: 42, height: 42, borderRadius: "50%", background: myName === p ? "rgba(255,255,255,0.2)" : "#2a3942", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 700, color: myName === p ? "#fff" : "#00a884", flexShrink: 0 }}>
              {p.charAt(0).toUpperCase()}
            </div>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</span>
            {myName === p && <span style={{ marginLeft: "auto", fontSize: 18 }}>✓</span>}
          </button>
        ))}
      </div>
    </div>
  );

  const curSearchIdx = Math.min(searchIdx, Math.max(0, searchMatches.length - 1));

  return (
    <div className="app-shell chat-shell" style={{ ...S.root, display: "flex", flexDirection: "column", height: "min(92vh, 760px)", background: "#111b21" }}>
      <h2 className="sr-only">WhatsApp chat viewer — {otherName}</h2>

      {/* Header */}
      <div className="chat-header" style={{ background: "#202c33", padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid #2a3942", flexShrink: 0 }}>
        <button onClick={() => { setStage("upload"); setMessages([]); setSearch(""); setShowSearch(false); }} aria-label="Back" style={{ background: "none", border: "none", color: "#8696a0", cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "2px 6px 2px 0" }}>‹</button>
        <div style={{ width: 42, height: 42, borderRadius: "50%", background: "linear-gradient(135deg,#25d366,#00a884)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
          {otherName.charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "#e9edef", fontSize: 15, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{otherName}</div>
          <div style={{ color: "#8696a0", fontSize: 11 }}>{stats.total.toLocaleString()} messages</div>
        </div>
        <button onClick={() => { setShowSearch(s => !s); if (showSearch) setSearch(""); }} aria-label="Search" style={{ background: "none", border: "none", color: showSearch ? "#00a884" : "#8696a0", cursor: "pointer", fontSize: 20, padding: "6px 8px", lineHeight: 1 }}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
        </button>
      </div>

      {/* Search bar */}
      {showSearch && (
        <div style={{ background: "#1f2c34", padding: "8px 14px", display: "flex", gap: 8, alignItems: "center", borderBottom: "1px solid #2a3942", flexShrink: 0 }}>
          <input ref={searchRef} value={search} onChange={e => { setSearch(e.target.value); setSearchIdx(0); }}
            placeholder="Search in chat…"
            style={{ flex: 1, background: "#2a3942", border: "none", borderRadius: 20, padding: "8px 14px", color: "#e9edef", fontSize: 14, outline: "none" }} />
          {searchMatches.length > 0 && (
            <span style={{ color: "#8696a0", fontSize: 12, whiteSpace: "nowrap" }}>{curSearchIdx + 1} / {searchMatches.length}</span>
          )}
          {search && searchMatches.length === 0 && (
            <span style={{ color: "#ef9f27", fontSize: 12, whiteSpace: "nowrap" }}>No results</span>
          )}
          {searchMatches.length > 1 && <>
            <button onClick={() => setSearchIdx(i => (i - 1 + searchMatches.length) % searchMatches.length)} aria-label="Previous" style={{ background: "none", border: "none", color: "#00a884", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>↑</button>
            <button onClick={() => setSearchIdx(i => (i + 1) % searchMatches.length)} aria-label="Next" style={{ background: "none", border: "none", color: "#00a884", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>↓</button>
          </>}
          {search && <button onClick={() => setSearch("")} aria-label="Clear" style={{ background: "none", border: "none", color: "#8696a0", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>✕</button>}
        </div>
      )}

      {/* Stats strip */}
      <div className="stats-strip" style={{ background: "#0b141a", borderBottom: "1px solid #182229", padding: "5px 16px", display: "flex", gap: 20, flexShrink: 0 }}>
        {[["💬", stats.total, "messages"], ["🟢", stats.mine, "from you"], ["🔵", stats.theirs, "received"], ["📎", stats.media, "media"]].map(([ic, n, lbl]) => (
          <div key={lbl} style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span style={{ fontSize: 12 }}>{ic}</span>
            <span style={{ color: "#e9edef", fontSize: 13, fontWeight: 600 }}>{n.toLocaleString()}</span>
            <span style={{ color: "#8696a0", fontSize: 11 }}>{lbl}</span>
          </div>
        ))}
      </div>

      {/* Messages */}
      <div ref={chatRef} onScroll={handleScroll}
        className="chat-scroll"
        style={{ flex: 1, overflowY: "auto", padding: "12px 14px 6px", background: "#0b141a", backgroundImage: WA_BG, position: "relative" }}>
        <div style={{ height: Math.max(0, visibleStart * itemHeight), pointerEvents: "none" }} />
        {visibleItems.map((item, idx) => {
          if (item.type === "date") return (
            <div key={item.key} style={{ textAlign: "center", margin: "14px 0 8px" }}>
              <span style={{ background: "rgba(11,20,26,0.88)", color: "#8696a0", fontSize: 12, padding: "4px 14px", borderRadius: 8, display: "inline-block", border: "1px solid #2a3942" }}>{item.label}</span>
            </div>
          );

          if (item.isSystem) return (
            <div key={item.key} style={{ textAlign: "center", margin: "4px 0" }}>
              <span style={{ background: "rgba(11,20,26,0.82)", color: "#8696a0", fontSize: 12, padding: "4px 14px", borderRadius: 8, display: "inline-block", maxWidth: "80%", border: "1px solid #182229" }}>{item.text}</span>
            </div>
          );

          const isMe = item.sender === myName;
          const isHit = searchMatchItems.some(match => match.id === item.id);
          const isFocused = isHit && currentMatch?.id === item.id;
          const prevItem = idx > 0 ? visibleItems[idx - 1] : null;
          const sameSenderAsPrev = prevItem?.type === "msg" && !prevItem.isSystem && prevItem.sender === item.sender;
          const mt = sameSenderAsPrev ? 2 : 8;

          return (
            <div key={item.key} id={"msg-" + item.id}
              style={{ display: "flex", justifyContent: isMe ? "flex-end" : "flex-start", marginBottom: 2, marginTop: mt }}>
              {!isMe && !sameSenderAsPrev && (
                <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#2a3942", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#00a884", flexShrink: 0, marginRight: 6, alignSelf: "flex-end", marginBottom: 2 }}>
                  {item.sender?.charAt(0).toUpperCase()}
                </div>
              )}
              {!isMe && sameSenderAsPrev && <div style={{ width: 36, flexShrink: 0 }} />}

              <div className="message-bubble" style={{
                maxWidth: "72%", minWidth: 80,
                background: isFocused ? "#ffd60a" : isHit ? "rgba(255,214,10,0.25)" : isMe ? "#005c4b" : "#202c33",
                borderRadius: isMe ? "12px 12px 0 12px" : "0 12px 12px 12px",
                padding: item.isMedia ? "8px 10px" : "5px 10px 6px",
                boxShadow: isFocused ? "0 0 0 2px #ffd60a" : "none",
                transition: "background 0.3s",
              }}>
                {!isMe && participants.length > 2 && !sameSenderAsPrev && (
                  <div style={{ color: "#00a884", fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{item.sender}</div>
                )}
                {item.isDeleted ? (
                  <div style={{ color: "#8696a0", fontStyle: "italic", fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                    🚫 <span>{item.text}</span>
                  </div>
                ) : item.isMedia ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 46, height: 46, borderRadius: 10, background: isMe ? "rgba(255,255,255,0.1)" : "#2a3942", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>
                      {getMediaIcon(item.text)}
                    </div>
                    <div>
                      <div style={{ color: isFocused ? "#000" : "#e9edef", fontSize: 13, fontWeight: 500 }}>
                        {item.text.toLowerCase().includes("video") ? "Video" : item.text.toLowerCase().includes("audio") ? "Audio" : item.text.toLowerCase().includes("document") ? "Document" : "Photo"}
                      </div>
                      <div style={{ color: isFocused ? "#444" : "#8696a0", fontSize: 11 }}>Not included in export</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ color: isFocused ? "#000" : "#e9edef", fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {search && isHit ? <Highlight text={item.text} query={search} matchId={item.id} isActive={isFocused} /> : item.text}
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 3, marginTop: 2 }}>
                  <span style={{ color: isFocused ? "#555" : "#8696a0", fontSize: 11 }}>{item.timeStr}</span>
                  {isMe && <span style={{ color: isFocused ? "#555" : "#53bdeb", fontSize: 14, lineHeight: 1 }}>✓✓</span>}
                </div>
              </div>
            </div>
          );
        })}
        <div style={{ height: Math.max(8, (allItems.length - Math.min(allItems.length, visibleStart + viewportSize + overscan)) * itemHeight) }} />
      </div>

      {/* Scroll to bottom + bottom bar */}
      <div style={{ background: "#202c33", padding: "8px 14px", display: "flex", alignItems: "center", gap: 10, borderTop: "1px solid #2a3942", flexShrink: 0, position: "relative" }}>
        {!atBottom && (
          <button onClick={() => { chatRef.current.scrollTop = chatRef.current.scrollHeight; setAtBottom(true); }}
            aria-label="Scroll to bottom"
            style={{ position: "absolute", top: -50, right: 16, width: 40, height: 40, borderRadius: "50%", background: "#202c33", border: "1px solid #2a3942", cursor: "pointer", color: "#8696a0", fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.4)" }}>
            ↓
          </button>
        )}
        <div style={{ flex: 1, background: "#2a3942", borderRadius: 24, padding: "10px 16px", color: "#8696a0", fontSize: 13, userSelect: "none" }}>
          This chat is read-only
        </div>
        <button aria-label="Go to latest" onClick={() => { chatRef.current.scrollTop = chatRef.current.scrollHeight; setAtBottom(true); }}
          style={{ width: 44, height: 44, borderRadius: "50%", background: "#00a884", border: "none", cursor: "pointer", color: "#fff", fontSize: 22, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          ↓
        </button>
      </div>
    </div>
  );
}
