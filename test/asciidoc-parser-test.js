'use strict'

const assert = require('assert'),
  fs = require('fs'),
  path = require('path'),
  AsciiDocParser = require('../lib/asciidoc-parser'),
  LineReader = require('../lib/line-reader')

describe('AsciiDocParser', () => {
  context('DocumentNode', () => {
    it('should create sparse DocumentNode from empty document', () => {
      const result = parseFixture(loadFixture('empty.adoc'))
      assert.equal(result.type, 'DocumentNode')
      assert.equal(result.raw, '')
      assert.deepEqual(result.range, [0, 0])
      assert.deepEqual(result.loc.start, { line: 1, column: 0 })
      assert.deepEqual(result.loc.end, { line: 1, column: 0 })
      assert.deepEqual(result.children, [])
    })
    it('should store raw text of document in raw property of DocumentNode', () => {
      const fixture = loadFixture('sample.adoc'),
          result = parseFixture(fixture)
      assert.equal(result.type, 'DocumentNode')
      // FIXME raw should preserve trailing newline
      assert.equal(result.raw, fixture.contents)
    })
  })

  context('HeaderNode', () => {
    it('should create HeaderNode if document starts with doctitle', () => {
      const result = parseFixture(loadFixture('doctitle.adoc'))
      assert.equal(result.type, 'DocumentNode')
      assert.equal(result.raw, '= Document Title\n')
      assert.equal(result.children.length, 1)
      const header = result.children[0]
      assert.equal(header.type, 'HeaderNode')
      assert.deepEqual(header.range, result.range)
      // TODO assert header node has children
    })
  })

  context('ParagraphNode', () => {
    it('should create ParagraphNode with one LineNode child if document contains one line of prose', () => {
      const result = parseFixture(loadFixture('paragraph-single-line.adoc'))
      assert.equal(result.children.length, 1)
      const para = result.children[0]
      assert.equal(para.type, 'ParagraphNode')
      assert.deepEqual(para.range, [0, 33])
      assert.deepEqual(para.loc.start, { line: 1, column: 0 })
      assert.deepEqual(para.loc.end, { line: 1, column: 33 })
      assert.equal(getSource(para, result), 'All this happened, more or less.\n')
      assert.equal(para.children.length, 1)
      const line = para.children[0]
      assert.equal(line.type, 'LineNode')
      assert.equal(getSource(line, result), 'All this happened, more or less.\n')
    })
    it('should create ParagraphNode with multiple LineNode children if document contains sequential lines of prose', () => {
      const result = parseFixture(loadFixture('paragraph-multiline.adoc'))
      assert.equal(result.children.length, 1)
      const para = result.children[0]
      assert.equal(para.children.length, 2)
      const [line1, line2] = para.children
      assert.equal(line1.type, 'LineNode')
      assert.equal(line2.type, 'LineNode')
      assert.deepEqual(line2.loc.end, { line: 2, column: 26 })
    })
    it('should create ParagraphNode for each sequence of prose lines separated by a blank line', () => {
      const result = parseFixture(loadFixture('paragraphs.adoc'))
      assert.equal(result.children.length, 2)
      const [para1, para2] = result.children
      assert.equal(para1.type, 'ParagraphNode')
      assert.deepEqual(para1.loc.start, { line: 1, column: 0 })
      assert.deepEqual(para1.loc.end, { line: 1, column: 121 })
      assert.equal(para2.type, 'ParagraphNode')
      assert.deepEqual(para2.loc.start, { line: 3, column: 0 })
      assert.deepEqual(para2.loc.end, { line: 3, column: 156 })
    })
  })

  context('SectionNode', () => {
    it('should create SectionNode if document contains section title', () => {
      const result = parseFixture(loadFixture('section-title-only.adoc'))
      assert.equal(result.children.length, 1)
      const sect = result.children[0]
      assert.equal(sect.type, 'SectionNode')
      assert.deepEqual(sect.range, [0, 9])
      assert.deepEqual(sect.loc.start, { line: 1, column: 0 })
      assert.deepEqual(sect.loc.end, { line: 1, column: 9 })
      assert.deepEqual(sect.children, [])
    })

    it('should add blocks that follow section title to SectionNode', () => {
      const result = parseFixture(loadFixture('section.adoc'))
      assert.equal(result.children.length, 1)
      const sect = result.children[0]
      assert.equal(sect.type, 'SectionNode')
      assert.equal(sect.children.length, 1)
      const para = sect.children[0]
      assert.equal(para.type, 'ParagraphNode')
    })

    it('should terminate SectionNode at start of sibling section', () => {
      const result = parseFixture(loadFixture('sections.adoc'))
      assert.equal(result.children.length, 3)
      const endingLines = [3, 7, 11] 
      result.children.forEach((sect, idx) => {
        assert.equal(sect.type, 'SectionNode')
        assert.equal(sect.children.length, 1)
        assert.equal(sect.children[0].type, 'ParagraphNode')
        assert.equal(sect.loc.end.line, endingLines[idx])
      })
    })
  })

  context('DelimitedBlockNode', () => {
    it('should create DelimitedBlockNode with LineNode children if delimited block is verbatim', () => {
      const result = parseFixture(loadFixture('verbatim-block.adoc'))
      assert.equal(result.children.length, 1)
      const lit = result.children[0]
      assert.equal(lit.type, 'DelimitedBlockNode')
      assert.equal(lit.enclosureType, 'literal')
      assert.equal(lit.delimiterLines.length, 2)
      assert.equal(lit.delimiterLines[0].raw, '....\n')
      assert.equal(lit.delimiterLines[0].raw, lit.delimiterLines[1].raw)
      assert.equal(lit.children.length, 5)
      lit.children.forEach((line, idx) => {
        assert.equal(line.type, 'LineNode')
        assert.equal(line.loc.start.line, idx + 2)
      })
    })
    it('should create DelimitedBlockNode with ParagraphNode child if document contains delimited block containing paragraph', () => {
      const result = parseFixture(loadFixture('example-block.adoc'))
      assert.equal(result.children.length, 1)
      const ex = result.children[0]
      assert.equal(ex.type, 'DelimitedBlockNode')
      assert.equal(ex.enclosureType, 'example')
      assert.deepEqual(ex.loc.start, { line: 1, column: 0 })
      assert.deepEqual(ex.loc.end, { line: 3, column: 5 })
      assert.equal(ex.delimiterLines.length, 2)
      assert.equal(ex.delimiterLines[0].raw, '====\n')
      assert.equal(ex.delimiterLines[0].raw, ex.delimiterLines[1].raw)
      assert.equal(ex.children.length, 1)
      const para = ex.children[0]
      assert.equal(para.type, 'ParagraphNode')
    })
    it('should create DelimitedBlockNode for each sibling delimited block of same type', () => {
      const result = parseFixture(loadFixture('example-blocks.adoc'))
      assert.equal(result.children.length, 3)
      result.children.forEach((ex) => {
        assert.equal(ex.type, 'DelimitedBlockNode')
        assert.equal(ex.enclosureType, 'example')
        assert.equal(ex.delimiterLines.length, 2)
        assert.equal(ex.children.length, 1)
        assert.equal(ex.children[0].type, 'ParagraphNode')
      })
    })
    it('should create DelimitedBlockNode for each sibling delimited block of different type', () => {
      const result = parseFixture(loadFixture('different-blocks.adoc'))
      assert.equal(result.children.length, 2)
      result.children.forEach((block) => {
        assert.equal(block.type, 'DelimitedBlockNode')
        assert.equal(block.delimiterLines.length, 2)
        assert.equal(block.children.length, 1)
        assert.equal(block.children[0].type, 'ParagraphNode')
      })
    })
    it('should create DelimitedBlockNode for nested delimited block with different type as enclosure', () => {
      const result = parseFixture(loadFixture('unlike-nested-block.adoc'))
      assert.equal(result.children.length, 1)
      const sidebar = result.children[0]
      assert.equal(sidebar.type, 'DelimitedBlockNode')
      assert.equal(sidebar.enclosureType, 'sidebar')
      assert.equal(sidebar.children.length, 3)
      const [para1, ex, para2] = sidebar.children
      assert.equal(para1.type, 'ParagraphNode')
      assert.equal(ex.type, 'DelimitedBlockNode')
      assert.equal(para2.type, 'ParagraphNode')
    })
    it('should create DelimitedBlockNode for nested delimited block with same type as enclosure', () => {
      const result = parseFixture(loadFixture('like-nested-block.adoc'))
      assert.equal(result.children.length, 1)
      const ex1 = result.children[0]
      assert.equal(ex1.type, 'DelimitedBlockNode')
      assert.equal(ex1.enclosureType, 'example')
      assert.equal(ex1.delimiterLines.length, 2)
      assert.equal(ex1.children.length, 2)
      const [para, ex2] = ex1.children
      assert.equal(para.type, 'ParagraphNode')
      assert.equal(ex2.type, 'DelimitedBlockNode')
      assert.equal(ex2.delimiterLines.length, 2)
    })
    it('should end delimited block prematurely if end of document is reached', () => {
      const result = parseFixture(loadFixture('unterminated-block.adoc'))
      assert.equal(result.children.length, 1)
      const block = result.children[0]
      assert.equal(block.type, 'DelimitedBlockNode')
      assert.equal(block.delimiterLines.length, 1)
      assert.deepEqual(block.loc.end, result.loc.end)
    })
    it('should end nested delimited block prematurely if end of enclosure is reached', () => {
      const result = parseFixture(loadFixture('unterminated-nested-block.adoc'))
      assert.equal(result.children.length, 1)
      const block = result.children[0]
      assert.equal(block.type, 'DelimitedBlockNode')
      assert.equal(block.enclosureType, 'sidebar')
      assert.equal(block.delimiterLines.length, 2)
      assert.deepEqual(block.loc.end, result.loc.end)
      assert.equal(block.children.length, 2)
      const nestedBlock = block.children[1]
      assert.equal(nestedBlock.type, 'DelimitedBlockNode')
      assert.equal(nestedBlock.enclosureType, 'example')
      assert.equal(nestedBlock.delimiterLines.length, 1)
      assert.equal(nestedBlock.loc.end.line, block.loc.end.line - 1)
    })
  })

  const loadFixture = (filename) => {
    let fixturePath = path.join(__dirname, 'fixtures', filename),
        fixtureContents = fs.readFileSync(fixturePath, 'UTF-8')
    return { path: fixturePath, contents: fixtureContents }
  }

  const parseFixture = (fixture) => new AsciiDocParser(new LineReader(fixture.contents).readLines()).parse()

  const getSource = (node, documentNode) => documentNode.raw.slice(node.range)
})
