/**
 * Build a printable file name in the format:
 *   File<index>-<pageSize>-<color>-<copies>
 *
 * @param {Object} opts
 * @param {number|string} opts.index   – Sequential number for the file (starting at 1)
 * @param {string}        opts.pageSize – Paper size (e.g. "A4", "A5")
 * @param {string}        opts.color    – Either "COLOR" or "BW" (case‑insensitive)
 * @param {number|string} opts.copies   – Number of copies
 * @returns {string} The formatted file name, e.g. "File1-A4-COLOR-2"
 */
export const buildPrintFileName = ({ index, pageSize, color, copies }) => {
    const safeIndex = Number(index) || 0;
    const safePages = String(pageSize || '').toUpperCase();
    const safeColor = String(color || '').toUpperCase();
    const safeCopies = Number(copies) || 0;

    return `File${safeIndex}-${safePages}-${safeColor}-${safeCopies}`;
};
