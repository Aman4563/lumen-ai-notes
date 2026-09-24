/** Saves generated content through a temporary object URL. */
export const downloadBlob = (name, parts, type = "application/octet-stream") => {
  const url = URL.createObjectURL(new Blob(parts, { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 2_000);
};
