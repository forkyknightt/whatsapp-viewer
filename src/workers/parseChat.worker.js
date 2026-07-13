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

self.onmessage = event => {
  if (event.data?.type !== "parse") return;
  const text = event.data.text;
  const lines = text.split("\n");
  const messages = [];
  const IOS_MSG = /^\[(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)\]\s+([^:]+):\s*([\s\S]*)/;
  const ANDROID_MSG = /^(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4}),\s*(\d{1,2}:\d{2}(?:\s*[AaPp][Mm])?)\s*-\s*([^:]+):\s*([\s\S]*)/;
  const IOS_SYS = /^\[(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)\]\s+([\s\S]+)/;
  const ANDROID_SYS = /^(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4}),\s*(\d{1,2}:\d{2}(?:\s*[AaPp][Mm])?)\s*-\s*([\s\S]+)/;
  let cur = null;
  let index = 0;
  const batchSize = 400;

  const step = () => {
    const end = Math.min(lines.length, index + batchSize);
    for (let i = index; i < end; i += 1) {
      const line = lines[i];
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

    index = end;
    self.postMessage({ type: "progress", processed: index, total: lines.length });
    if (index < lines.length) {
      setTimeout(step, 0);
    } else {
      if (cur) messages.push(cur);
      const parsed = messages.map(msg => {
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
      self.postMessage({ type: "parsed", parsed });
    }
  };

  self.postMessage({ type: "progress", processed: 0, total: lines.length });
  setTimeout(step, 0);
};
