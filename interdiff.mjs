import { parsePatch, applyPatch, createTwoFilesPatch } from 'diff'

/**
 * Applies a single file patch object to an initial string.
 * Uses permissive context line matching if standard application fails.
 *
 * @param {object} filePatch - Parsed single file patch object from parsePatch().
 * @returns {string} The resulting file content string.
 */
function getFileContent (filePatch) {
  if (!filePatch) return ''
  const result = applyPatch('', filePatch)
  if (result !== false) return result

  const fuzzyResult = applyPatch('', filePatch, {
    fuzzFactor: 100,
    compareLine: () => true
  })
  return fuzzyResult !== false ? fuzzyResult : ''
}

/**
 * Computes the interdiff (delta) between two cumulative unified diff patch strings (P1 and P2).
 * Both patch strings represent changes relative to the same initial base state.
 *
 * @param {string} patch1Str - The previous cumulative patch string (or empty if first patch).
 * @param {string} patch2Str - The current cumulative patch string.
 * @returns {string} The computed interdiff string showing only changes from P1 to P2.
 */
export function computeInterdiff (patch1Str, patch2Str) {
  if (!patch1Str) {
    return patch2Str || ''
  }
  if (!patch2Str) {
    return ''
  }
  if (patch1Str.trim() === patch2Str.trim()) {
    return ''
  }

  const parsedP1 = parsePatch(patch1Str)
  const parsedP2 = parsePatch(patch2Str)

  const mapP1 = new Map()
  for (const filePatch of parsedP1) {
    const filename = (filePatch.newFileName || filePatch.oldFileName).replace(/^[ab]\//, '')
    mapP1.set(filename, filePatch)
  }

  const mapP2 = new Map()
  for (const filePatch of parsedP2) {
    const filename = (filePatch.newFileName || filePatch.oldFileName).replace(/^[ab]\//, '')
    mapP2.set(filename, filePatch)
  }

  const allFiles = new Set([...mapP1.keys(), ...mapP2.keys()])
  let interdiffResult = ''

  for (const filename of allFiles) {
    const patchObj1 = mapP1.get(filename)
    const patchObj2 = mapP2.get(filename)

    const contentP1 = getFileContent(patchObj1)
    const contentP2 = getFileContent(patchObj2)

    if (contentP1 !== contentP2) {
      const delta = createTwoFilesPatch(
        `a/${filename}`,
        `b/${filename}`,
        contentP1,
        contentP2,
        '',
        ''
      )
      interdiffResult += delta + '\n'
    }
  }

  return interdiffResult.trim()
}
