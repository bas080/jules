import { test, describe } from 'node:test'
import assert from 'node:assert'
import { computeInterdiff } from '../interdiff.mjs'

describe('Interdiff Unit Tests', () => {
  test('returns current patch string when previous patch is empty', () => {
    const current = '--- a/file.txt\n+++ b/file.txt\n@@ -0,0 +1,2 @@\n+line 1\n+line 2\n'
    const result = computeInterdiff('', current)
    assert.match(result, /diff --git a\/file\.txt b\/file\.txt/)
    assert.match(result, /new file mode 100644/)
    assert.match(result, /--- \/dev\/null/)
    assert.match(result, /\+\+\+ b\/file\.txt/)
    assert.match(result, /\+line 1/)
    assert.match(result, /\+line 2/)
  })

  test('returns empty string when previous and current patches are identical', () => {
    const patch = '--- a/file.txt\n+++ b/file.txt\n@@ -0,0 +1,2 @@\n+line 1\n+line 2\n'
    const result = computeInterdiff(patch, patch)
    assert.strictEqual(result, '')
  })

  test('computes interdiff between two cumulative single-file patches', () => {
    const p1 = '--- a/file.txt\n+++ b/file.txt\n@@ -0,0 +1,2 @@\n+line 1\n+line 2\n'
    const p2 = '--- a/file.txt\n+++ b/file.txt\n@@ -0,0 +1,3 @@\n+line 1\n+line 2\n+line 3\n'
    const result = computeInterdiff(p1, p2)
    assert.match(result, /diff --git a\/file\.txt b\/file\.txt/)
    assert.match(result, /--- a\/file\.txt/)
    assert.match(result, /\+\+\+ b\/file\.txt/)
    assert.match(result, /\+line 3/)
    assert.doesNotMatch(result, /\+line 1/)
  })

  test('computes interdiff between multi-file patches', () => {
    const p1 = '--- a/file1.txt\n+++ b/file1.txt\n@@ -0,0 +1,2 @@\n+file1 line 1\n+file1 line 2\n--- a/file2.txt\n+++ b/file2.txt\n@@ -0,0 +1,1 @@\n+file2 line 1\n'
    const p2 = '--- a/file1.txt\n+++ b/file1.txt\n@@ -0,0 +1,3 @@\n+file1 line 1\n+file1 line 2\n+file1 line 3\n--- a/file2.txt\n+++ b/file2.txt\n@@ -0,0 +1,2 @@\n+file2 line 1\n+file2 line 2\n'
    const result = computeInterdiff(p1, p2)
    assert.match(result, /diff --git a\/file1\.txt b\/file1\.txt/)
    assert.match(result, /diff --git a\/file2\.txt b\/file2\.txt/)
    assert.match(result, /\+file1 line 3/)
    assert.match(result, /\+file2 line 2/)
  })
})
