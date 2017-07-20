'use strict'

const DoctitleRx = /^= \S/
const AuthorLineRx = /^[A-Za-z0-9_][A-Za-z0-9_\-'.]*(?: +[A-Za-z0-9_[A-Za-z0-9_\-'.]*)?(?: +[A-Za-z0-9_][A-Za-z0-9_\-'.]*)?(?: +<([^>]+)>)?$/
const RevisionLineRx = /^(?:\D*.*?,)? *(?!:).*?(?: *(?!^): *.*)?$/
const SectionTitleRx = /^=(={0,5}) \S/
const AttributeEntryRx = /^:([^:\s]+):(?:[ \t]+(.+))?$/
const BlockAttributeLineRx = /^\[(?:|[A-Za-z0-9_.#%{,"'].*|\[(?:|[A-Za-z_:][A-Za-z0-9_:.-]*(?:, *.+)?)\])\]$/
const BlockMacroRx = /^[A-Za-z0-9_]+::(?:|\S|\S.*?\S)\[.*\]$/
// FIXME DelimiterInfo should probably be a type managed by DelimiterRegistry
const BlockDelimiterMap = {
  '--':   ['open', undefined, true],
  '----': ['listing', '-', false],
  '....': ['literal', '.', false],
  '====': ['example', '=', true],
  '|===': ['table', '=', true],
  '!===': ['table', '=', true],
  '////': ['comment', '/', false],
  '****': ['sidebar', '*', true],
  '____': ['quote', '_', true],
  '++++': ['pass', '+', false]
}

module.exports = class AsciiDocParser {
  // QUESTION should constructor accept both text and lines?
  constructor (lines) {
    this.rawText = (this.lines = lines).map((line) => line.rawText).join('')
  }

  // QUESTION should parse accept source text/lines as argument?
  parse () {
    const doc = {
      type: 'DocumentNode',
      raw: this.rawText,
      range: [0, this.rawText.length],
      loc: {
        start: this.lines[0].start,
        end: this.lines[this.lines.length - 1].end
      },
      children: []
    }
    const header = this.readHeader()
    if (header) doc.children.push(header)
    let block
    while ((block = this.readBlock(this.readInterveningLines(), { sections: true }))) {
      doc.children.push(block)
    }
    return doc
  }

  readHeader () {
    // TODO add call to readInterveningLines()
    let nextLine, nextLineText
    if ((nextLine = this.peekLine()) && !nextLine.isBlank() &&
        (nextLineText = nextLine.text).startsWith('=') && DoctitleRx.test(nextLineText)) {
      const titleLine = this.readLine()
      const header = {
        type: 'HeaderNode',
        loc: {
          start: nextLine.start
        },
        // QUESTION should we store doctitle as TitleNode instead? or titleLine property?
        children: [{
          type: 'LineNode',
          raw: nextLine.rawText,
          range: nextLine.range,
          loc: nextLine.loc
        }]
      }
      let authorLine, revisionLine
      while ((nextLine = this.peekLine()) && !nextLine.isBlank()) {
        if ((nextLineText = nextLine.text).startsWith(':')) {
          const m = nextLineText.match(AttributeEntryRx)
          // TODO read continuation lines
          if (m) {
            this.readLine()
            header.children.push({
              type: 'AttributeEntryNode',
              raw: nextLine.rawText,
              name: m[1],
              value: m[2],
              range: nextLine.range,
              loc: nextLine.loc
            })
          }
          else {
            break
          }
        }
        else if (this.isLineComment(nextLine)) {
          this.readLine()
        }
        else if (!authorLine) {
          const m = nextLineText.match(AuthorLineRx)
          if (m) {
            authorLine = this.readLine()
            header.children.push({
              type: 'LineNode',
              raw: nextLine.rawText,
              range: nextLine.range,
              loc: nextLine.loc
            })
          }
          else {
            break
          }
        }
        else if (!revisionLine) {
          const m = nextLineText.match(RevisionLineRx)
          if (m) {
            revisionLine = this.readLine()
            header.children.push({
              type: 'LineNode',
              raw: nextLine.rawText,
              range: nextLine.range,
              loc: nextLine.loc
            })
          }
          else {
            break
          }
        }
        else {
          break
        }
      }
      this.endBlock(header, titleLine, (header.children[header.children.length - 1] || titleLine))
      return header
    }
  }

  readBlock (dataLines, opts = {}) {
    let nextLine = this.peekLine(), block, sectionLevel
    if (nextLine) {
      if (opts.sections && (sectionLevel = this.isSectionTitle(nextLine))) {
        if (sectionLevel > (opts.sectionLevel || -1)) {
          block = this.readSection(sectionLevel, dataLines)
        }
      }
      else if (this.isBlockDelimiter(nextLine)) {
        // catch case when a block prematurely terminates at an enclosing delimiter
        // QUESTION can we move this logic into readDelimitedBlock?
        if ((opts.enclosures || []).length > 1 &&
            opts.enclosures.slice(1).findIndex((candidate) => nextLine.matches(candidate)) >= 0) return
        // QUESTION should we pass value of this.readLine() to method?
        block = this.readDelimitedBlock(dataLines, opts)
      }
      else if (this.isBlockMacro(nextLine)) {
        block = this.readBlockMacro(dataLines)
      }
      else {
        block = this.readParagraph(dataLines)
      }
    }
    return block 
  }

  readSection (level, dataLines) {
    const titleLine = this.readLine(),
        // QUESTION should we store titleLine as entry in SectionNode?
        section = {
          type: 'SectionNode',
          data: dataLines,
          loc: {
            // QUESTION should we include dataLines when defining start?
            start: titleLine.start
          },
          // QUESTION should we store section title as TitleNode? or titleLine property?
          children: []
        }
    let block
    // read blocks until next sibling or parent section
    // FIXME restore intervening lines if reached end of section
    while ((block = this.readBlock(this.readInterveningLines(section), { sections: true, sectionLevel: level }))) {
      section.children.push(block)
    }
    this.endBlock(section, titleLine, (section.children[section.children.length - 1] || titleLine))
    return section
  }

  // TODO consider style override when determining how to parse (i.e., composition type)
  readDelimitedBlock (dataLines, opts = {}) {
    const startDelimiterLine = this.readLine(),
        delimiterText = startDelimiterLine.text,
        delimiterStem = delimiterText === '--' ? delimiterText : delimiterText.slice(0, 4),
        delimiterInfo = BlockDelimiterMap[delimiterStem],
        supportsBlockChildren = delimiterInfo[2],
        block = {
          type: 'DelimitedBlockNode',
          delimiterLines: [this.createLineNode(startDelimiterLine)],
          enclosureType: delimiterInfo[0],
          //compositionType: (explicit style or enclosureType)
          data: dataLines,
          loc: {
            // QUESTION should we include dataLines when defining start?
            start: startDelimiterLine.start
          },
          children: []
        }
    let nextLine, prevLine, lastNode
    if (supportsBlockChildren) {
      let childBlock, dataLines = this.readInterveningLines(block),
          childOpts = { enclosures: [startDelimiterLine].concat(opts.enclosures || []) }
      while ((nextLine = this.peekLine())) {
        if (nextLine.matches(startDelimiterLine)) {
          block.delimiterLines.push(this.createLineNode((prevLine = this.readLine())))
          break
        }
        else if ((childBlock = this.readBlock(dataLines, childOpts))) {
          block.children.push(childBlock)
          dataLines = this.readInterveningLines(block)
        }
        else {
          // HACK we assume block was prematurely terminated, so move cursor to last child
          childBlock = block.children[block.children.length - 1]
          // QUESTION should we distinguish between false (early termination) and undefined (no block to read)?
          break
        }
      }
      // FIXME store orphaned data lines on block so we know they are lingering
      lastNode = prevLine || childBlock || startDelimiterLine
    }
    else {
      while ((nextLine = this.readLine())) {
        prevLine = nextLine
        if (nextLine.matches(startDelimiterLine)) {
          block.delimiterLines.push(this.createLineNode(nextLine))
          break
        }
        block.children.push(this.createLineNode(nextLine))
      }
      lastNode = prevLine || startDelimiterLine
    }
    this.endBlock(block, startDelimiterLine, lastNode)
    return block
  }

  readBlockMacro (dataLines) {
    const macroLine = this.readLine()
    return {
      type: 'BlockMacroNode',
      data: dataLines,
      raw: macroLine.rawText,
      range: macroLine.range,
      // QUESTION should we include dataLines when defining start?
      loc: macroLine.loc
    }
  }

  readParagraph (dataLines) {
    let block, nextLine
    while ((nextLine = this.peekLine())) {
      if (block) {
        if (nextLine.isBlank() || this.isStartOfBlock(nextLine)) {
          break
        }
      }
      else {
        block = {
          type: 'ParagraphNode',
          data: dataLines, 
          loc: {
            // QUESTION should we include dataLines when defining start?
            start: nextLine.start
          },
          children: []
        }
      }
      // QUESTION should we store line comments in node?
      if (!this.isLineComment(this.readLine())) block.children.push(this.createLineNode(nextLine))
    }

    if (block && block.children.length > 0) {
      // QUESTION should we store line comments in the value of raw?
      this.endBlock(block, block.children[0], block.children[block.children.length - 1])
      return block
    }
  }

  readInterveningLines (parent) {
    const dataLines = []
    let nextLine, nextLineText
    while ((nextLine = this.peekLine())) {
      if (nextLine.isBlank()) {
        this.readLine()
      }
      else if ((nextLineText = nextLine.text).startsWith(':')) {
        const m = nextLineText.match(AttributeEntryRx)
        // TODO read continuation lines
        if (m) {
          this.readLine()
          const attributeEntry = {
            type: 'AttributeEntryNode',
            raw: nextLine.rawText,
            name: m[1],
            value: m[2],
            range: nextLine.range,
            loc: nextLine.loc
          }
          parent.children.push(attributeEntry)
        }
        else {
          break
        }
      }
      else if (nextLineText.startsWith('[')) {
        if (nextLineText.endsWith(']') && BlockAttributeLineRx.test(nextLineText)) {
          // FIXME create proper node objects
          dataLines.push(this.readLine())
        }
        else {
          break
        }
      }
      else {
        // QUESTION what about line comments?
        break
      }
    }
    return dataLines
  }

  peekLine () {
    return this.lines[0]
  }

  readLine () {
    return this.lines.shift()
  }

  isStartOfBlock (line) {
    let lineText
    return (lineText = line.text).startsWith('[') ? BlockAttributeLineRx.test(lineText) : this.isBlockDelimiter(line)
  }

  isBlockDelimiter (line) {
    if (line.isBlank()) return
    let lineText, lineTextLength, delimiterInfo
    if ((lineText = line.text) === '--') {
      return true
    }
    // FIXME need to rtrim lineText to match behavior of Asciidoctor
    else if ((lineTextLength = lineText.length) > 3 && (delimiterInfo = BlockDelimiterMap[lineText.slice(0, 4)]) &&
        lineText.slice(1) === delimiterInfo[1].repeat(lineTextLength - 1)) {
      return true
    }
  }

  isSectionTitle (line) {
    let lineText, m
    return !line.isBlank() && (lineText = line.text).startsWith('=') && (m = lineText.match(SectionTitleRx)) && m[1].length
  }

  isBlockMacro (line) {
    let lineText
    return !line.isBlank() && (lineText = line.text).includes('::') && BlockMacroRx.test(lineText)
  }

  isLineComment (line) {
    let lineText
    return !line.isBlank() && (lineText = line.text).startsWith('//') && !lineText.startsWith('///')
  }

  createLineNode (line) {
    return {
      type: 'LineNode',
      raw: line.rawText,
      range: line.range,
      loc: line.loc
    }
  }

  endBlock(containerNode, startNode, lastNode) {
    const range = (containerNode.range = [startNode.range[0], lastNode.range[1]])
    containerNode.raw = this.rawText.slice(range[0], range[1])
    containerNode.loc.end = lastNode.loc.end
  }
}
