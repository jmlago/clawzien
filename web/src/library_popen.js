/**
 * Emscripten JS library: overrides popen()/pclose() at link time.
 *
 * - Curl commands from http_post() → browser fetch()
 * - Shell commands from tool_execute() → WebContainers via Module._shellExec()
 *
 * Output is written to a temp file in MEMFS and returned as a FILE*.
 */

mergeInto(LibraryManager.library, {

  /* ── popen() ─────────────────────────────────────────── */

  popen__async: true,
  popen__deps: ['fopen', 'fclose', '$FS'],
  popen: function (commandPtr, typePtr) {
    return Asyncify.handleAsync(async function () {
      var cmd = UTF8ToString(commandPtr);
      var output = '';

      if (cmd.indexOf('curl ') === 0 && cmd.indexOf("-K '/tmp/.szc_hdr_") !== -1) {
        /* ── http_post() curl → fetch() ───────────────── */
        output = await Module['_doCurlFetch'](cmd, FS);
      } else {
        /* ── shell command → WebContainers ────────────── */
        output = await Module['_shellExec'](cmd);
      }

      /* Write output to MEMFS temp file */
      var tmpPath = '/tmp/.popen_' + Date.now() + '_' + Math.floor(Math.random() * 1e9);
      FS.writeFile(tmpPath, output || '');

      /* Open temp file and return FILE* */
      var pathLen = lengthBytesUTF8(tmpPath) + 1;
      var pathPtr = _malloc(pathLen);
      stringToUTF8(tmpPath, pathPtr, pathLen);

      var modePtr = _malloc(2);
      stringToUTF8('r', modePtr, 2);

      var fp = _fopen(pathPtr, modePtr);
      _free(pathPtr);
      _free(modePtr);

      if (!Module['_popenFiles']) Module['_popenFiles'] = new Map();
      Module['_popenFiles'].set(fp, tmpPath);
      return fp;
    });
  },

  /* ── pclose() ────────────────────────────────────────── */

  pclose__deps: ['fclose', '$FS'],
  pclose: function (fp) {
    if (Module['_popenFiles']) {
      var path = Module['_popenFiles'].get(fp);
      Module['_popenFiles'].delete(fp);
      _fclose(fp);
      if (path) {
        try { FS.unlink(path); } catch (e) { /* already removed */ }
      }
    } else {
      _fclose(fp);
    }
    return 0;
  },
});
