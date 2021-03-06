import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import path from 'path'
import { Disposable, Emitter } from 'vscode-languageserver-protocol'
import { Location, Position, Range, TextDocumentEdit, TextEdit, VersionedTextDocumentIdentifier, WorkspaceEdit, CreateFile, DeleteFile, RenameFile } from 'vscode-languageserver-types'
import URI from 'vscode-uri'
import { ConfigurationTarget } from '../../types'
import { disposeAll } from '../../util'
import { readFile, writeFile } from '../../util/fs'
import helper, { createTmpFile } from '../helper'
import { ErrorItem } from '../../model/configurations'
import workspace from '../../workspace'
import { TextDocumentContentProvider } from '../../provider'

let nvim: Neovim
let disposables: Disposable[] = []

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
  disposeAll(disposables)
  disposables = []
})

describe('workspace properties', () => {

  it('should have initialized', () => {
    let { nvim, channelNames, rootPath, cwd, documents, initialized, textDocuments } = workspace
    expect(nvim).toBeTruthy()
    expect(initialized).toBe(true)
    expect(channelNames.length).toBe(0)
    expect(documents.length).toBe(1)
    expect(textDocuments.length).toBe(1)
    expect(rootPath).toBe(process.cwd())
    expect(cwd).toBe(process.cwd())
  })

  it('should check isVim and isNvim', async () => {
    let { isVim, isNvim } = workspace
    expect(isVim).toBe(false)
    expect(isNvim).toBe(true)
  })

  it('should find rootPath from workspace folder', async () => {
    let file = path.resolve(__dirname, '../sample/foo.js')
    await nvim.command(`edit ${file}`)
    await helper.wait(100)
    expect(workspace.rootPath).toBe(path.resolve(file, '../.vim/src'))
  })

  it('should return plugin root', () => {
    let { pluginRoot } = workspace
    expect(pluginRoot).toBe(process.cwd())
  })

  it('should ready', async () => {
    (workspace as any)._initialized = false
    let p = workspace.ready
      ; (workspace as any)._initialized = true
      ; (workspace as any)._onDidWorkspaceInitialized.fire(void 0)
    await p
  })

  it('should get filetyps', async () => {
    await helper.edit('foo.js')
    let filetypes = workspace.filetypes
    expect(filetypes.has('javascript')).toBe(true)
  })
})

describe('workspace applyEdits', () => {
  it('should apply TextEdit of documentChanges', async () => {
    let doc = await helper.createDocument('foo')
    let versioned = VersionedTextDocumentIdentifier.create(doc.uri, doc.version)
    let edit = TextEdit.insert(Position.create(0, 0), 'bar')
    let change = TextDocumentEdit.create(versioned, [edit])
    let workspaceEdit: WorkspaceEdit = {
      documentChanges: [change]
    }
    let res = await workspace.applyEdit(workspaceEdit)
    expect(res).toBe(true)
    let line = await nvim.getLine()
    expect(line).toBe('bar')
  })

  it('should not apply TextEdit if version miss match', async () => {
    let doc = await helper.createDocument('foo')
    let versioned = VersionedTextDocumentIdentifier.create(doc.uri, 10)
    let edit = TextEdit.insert(Position.create(0, 0), 'bar')
    let change = TextDocumentEdit.create(versioned, [edit])
    let workspaceEdit: WorkspaceEdit = {
      documentChanges: [change]
    }
    let res = await workspace.applyEdit(workspaceEdit)
    expect(res).toBe(false)
  })

  it('should apply edits with changes to buffer', async () => {
    let doc = await helper.createDocument('foo')
    let changes = {
      [doc.uri]: [TextEdit.insert(Position.create(0, 0), 'bar')]
    }
    let workspaceEdit: WorkspaceEdit = { changes }
    let res = await workspace.applyEdit(workspaceEdit)
    expect(res).toBe(true)
    let line = await nvim.getLine()
    expect(line).toBe('bar')
  })

  it('should apply edits with changes to file not in buffer list', async () => {
    let filepath = await createTmpFile('bar')
    let uri = URI.file(filepath).toString()
    let changes = {
      [uri]: [TextEdit.insert(Position.create(0, 0), 'foo')]
    }
    let p = workspace.applyEdit({ changes })
    await helper.wait(100)
    await nvim.input('y')
    let res = await p
    expect(res).toBe(true)
    let content = await readFile(filepath, 'utf8')
    expect(content).toBe('foobar')
  })

  it('should not apply edits when file not exists', async () => {
    let filepath = '/tmp/abcedf'
    let uri = URI.file(filepath).toString()
    let changes = {
      [uri]: [TextEdit.insert(Position.create(0, 0), 'foo')]
    }
    let res = await workspace.applyEdit({ changes })
    expect(res).toBe(false)
  })

  it('should return false for invalid documentChanges', async () => {
    let uri = URI.file('/tmp/not_exists').toString()
    let versioned = VersionedTextDocumentIdentifier.create(uri, 10)
    let edit = TextEdit.insert(Position.create(0, 0), 'bar')
    let change = TextDocumentEdit.create(versioned, [edit])
    let workspaceEdit: WorkspaceEdit = {
      documentChanges: [change]
    }
    let res = await workspace.applyEdit(workspaceEdit)
    expect(res).toBe(false)
  })

  it('should return false for invalid changes schemas', async () => {
    let uri = URI.parse('http://foo').toString()
    let changes = {
      [uri]: [TextEdit.insert(Position.create(0, 0), 'foo')]
    }
    let res = await workspace.applyEdit({ changes })
    expect(res).toBe(false)
    let versioned = VersionedTextDocumentIdentifier.create('test://', null)
    let edit = TextEdit.insert(Position.create(0, 0), 'bar')
    let documentChanges = [TextDocumentEdit.create(versioned, [edit])]
    res = await workspace.applyEdit({ documentChanges })
    expect(res).toBe(false)
  })

  it('should return false for change to file not exists', async () => {
    let uri = URI.file('/tmp/not_exists').toString()
    let versioned = VersionedTextDocumentIdentifier.create(uri, null)
    let edit = TextEdit.insert(Position.create(0, 0), 'bar')
    let documentChanges = [TextDocumentEdit.create(versioned, [edit])]
    let res = await workspace.applyEdit({ documentChanges })
    expect(res).toBe(false)
  })

  it('should support null version of documentChanges', async () => {
    let file = path.join(__dirname, 'foo')
    await workspace.createFile(file, { ignoreIfExists: true, overwrite: true })
    let uri = URI.file(file).toString()
    let versioned = VersionedTextDocumentIdentifier.create(uri, null)
    let edit = TextEdit.insert(Position.create(0, 0), 'bar')
    let change = TextDocumentEdit.create(versioned, [edit])
    let workspaceEdit: WorkspaceEdit = {
      documentChanges: [change]
    }
    let p = workspace.applyEdit(workspaceEdit)
    await helper.wait(50)
    await nvim.input('y<enter>')
    let res = await p
    expect(res).toBe(true)
    let content = await readFile(file, 'utf8')
    expect(content).toBe('bar')
    await workspace.deleteFile(file, { ignoreIfNotExists: true })
  })

  it('should support CreateFile edit', async () => {
    let file = path.join(__dirname, 'foo')
    let uri = URI.file(file).toString()
    let workspaceEdit: WorkspaceEdit = {
      documentChanges: [CreateFile.create(uri, { overwrite: true })]
    }
    let res = await workspace.applyEdit(workspaceEdit)
    expect(res).toBe(true)
    await workspace.deleteFile(file, { ignoreIfNotExists: true })
  })

  it('should support DeleteFile edit', async () => {
    let file = path.join(__dirname, 'foo')
    await workspace.createFile(file, { ignoreIfExists: true, overwrite: true })
    let uri = URI.file(file).toString()
    let workspaceEdit: WorkspaceEdit = {
      documentChanges: [DeleteFile.create(uri)]
    }
    let res = await workspace.applyEdit(workspaceEdit)
    expect(res).toBe(true)
  })

  it('should check uri for CreateFile edit', async () => {
    let workspaceEdit: WorkspaceEdit = {
      documentChanges: [CreateFile.create('term://.', { overwrite: true })]
    }
    let res = await workspace.applyEdit(workspaceEdit)
    expect(res).toBe(false)
  })

  it('should support RenameFile edit', async () => {
    let file = path.join(__dirname, 'foo')
    await workspace.createFile(file, { ignoreIfExists: true, overwrite: true })
    let newFile = path.join(__dirname, 'bar')
    let uri = URI.file(file).toString()
    let workspaceEdit: WorkspaceEdit = {
      documentChanges: [RenameFile.create(uri, URI.file(newFile).toString())]
    }
    let res = await workspace.applyEdit(workspaceEdit)
    expect(res).toBe(true)
    await workspace.deleteFile(newFile, { ignoreIfNotExists: true })
  })
})

describe('workspace methods', () => {
  it('should get the document', async () => {
    let buf = await helper.edit('foo')
    await helper.wait(100)
    let doc = workspace.getDocument(buf.id)
    expect(doc.buffer.equals(buf)).toBeTruthy()
    doc = workspace.getDocument(doc.uri)
    expect(doc.buffer.equals(buf)).toBeTruthy()
  })

  it('should get offset', async () => {
    let buf = await nvim.buffer
    await buf.setLines(['foo', 'bar'], { start: 0, end: 0 })
    await helper.wait(100)
    await nvim.call('cursor', [2, 2])
    let n = await workspace.getOffset()
    expect(n).toBe(5)
  })

  it('should get format options', async () => {
    let opts = await workspace.getFormatOptions()
    expect(opts.insertSpaces).toBe(true)
    expect(opts.tabSize).toBe(2)
  })

  it('should get format options of current buffer', async () => {
    let buf = await helper.edit('foo')
    await buf.setOption('tabstop', 8)
    await buf.setOption('expandtab', false)
    let doc = workspace.getDocument(buf.id)
    let opts = await workspace.getFormatOptions(doc.uri)
    expect(opts.insertSpaces).toBe(false)
    expect(opts.tabSize).toBe(8)
  })

  it('should get format options when uri not exists', async () => {
    let uri = URI.file('/tmp/foo').toString()
    let opts = await workspace.getFormatOptions(uri)
    expect(opts.insertSpaces).toBe(true)
    expect(opts.tabSize).toBe(2)
  })

  it('should get config files', async () => {
    let file = workspace.getConfigFile(ConfigurationTarget.Global)
    expect(file).toBeTruthy()
    file = workspace.getConfigFile(ConfigurationTarget.User)
    expect(file).toBeTruthy()
  })

  it('should create file watcher', async () => {
    let watcher = workspace.createFileSystemWatcher('**/*.ts')
    expect(watcher).toBeTruthy()
  })

  it('should get quickfix item from Location', async () => {
    let filepath = await createTmpFile('quickfix')
    let uri = URI.file(filepath).toString()
    let p = Position.create(0, 0)
    let loc = Location.create(uri, Range.create(p, p))
    let item = await workspace.getQuickfixItem(loc)
    expect(item.filename).toBe(filepath)
    expect(item.text).toBe('quickfix')
  })

  it('should get line of document', async () => {
    let doc = await helper.createDocument('tmp')
    await nvim.setLine('abc')
    let line = await workspace.getLine(doc.uri, 0)
    expect(line).toBe('abc')
  })

  it('should get line of file', async () => {
    let filepath = await createTmpFile('quickfix')
    let uri = URI.file(filepath).toString()
    let line = await workspace.getLine(uri, 0)
    expect(line).toBe('quickfix')
  })

  it('should echo lines', async () => {
    await workspace.echoLines(['a', 'b'])
    let ch = await nvim.call('screenchar', [79, 1])
    let s = String.fromCharCode(ch)
    expect(s).toBe('a')
  })

  it('should echo multiple lines with truncate', async () => {
    await workspace.echoLines(['a', 'b', 'd', 'e'], true)
    let ch = await nvim.call('screenchar', [79, 1])
    let s = String.fromCharCode(ch)
    expect(s).toBe('a')
  })

  it('should read content from buffer', async () => {
    let doc = await helper.createDocument('ade')
    await nvim.setLine('foo')
    await helper.wait(100)
    let line = await workspace.readFile(doc.uri)
    expect(line).toBe('foo\n')
  })

  it('should read content from file', async () => {
    let filepath = await createTmpFile('content')
    let content = await workspace.readFile(URI.file(filepath).toString())
    expect(content).toBe(content)
  })

  it('should get current document', async () => {
    let buf = await helper.edit('foo')
    let doc = await workspace.document
    expect(doc.bufnr).toBe(buf.id)
    buf = await helper.edit('tmp')
    doc = await workspace.document
    expect(doc.bufnr).toBe(buf.id)
  })

  it('should run command', async () => {
    let res = await workspace.runCommand('ls', __dirname, 1)
    expect(res).toMatch('workspace')
  })

  it('should run terminal command', async () => {
    let res = await workspace.runTerminalCommand('ls', __dirname)
    expect(res.success).toBe(true)
  })

  it('should show mesages', async () => {
    await helper.edit('tmp')
    workspace.showMessage('error', 'error')
    await helper.wait(30)
    let str = await helper.getCmdline()
    expect(str).toMatch('error')
    workspace.showMessage('warning', 'warning')
    await helper.wait(30)
    str = await helper.getCmdline()
    expect(str).toMatch('warning')
    workspace.showMessage('moremsg')
    await helper.wait(30)
    str = await helper.getCmdline()
    expect(str).toMatch('moremsg')
  })

  it('should resolve module path if exists', async () => {
    let res = await workspace.resolveModule('typescript')
    expect(res).toBeTruthy()
  })

  it('should not resolve module if not exists', async () => {
    let res = await workspace.resolveModule('foo')
    expect(res).toBeFalsy()
  })

  it('should return match score for document', async () => {
    let doc = await helper.createDocument('tmp.xml')
    expect(workspace.match(['xml'], doc.textDocument)).toBe(10)
    expect(workspace.match(['wxml'], doc.textDocument)).toBe(0)
    expect(workspace.match([{ language: 'xml' }], doc.textDocument)).toBe(10)
    expect(workspace.match([{ language: 'wxml' }], doc.textDocument)).toBe(0)
    expect(workspace.match([{ pattern: '**/*.xml' }], doc.textDocument)).toBe(5)
    expect(workspace.match([{ pattern: '**/*.html' }], doc.textDocument)).toBe(0)
    expect(workspace.match([{ scheme: 'file' }], doc.textDocument)).toBe(5)
    expect(workspace.match([{ scheme: 'term' }], doc.textDocument)).toBe(0)
    expect(workspace.match([{ language: 'xml' }, { scheme: 'file' }], doc.textDocument)).toBe(10)
  })

  it('should get vim settings', () => {
    let version = workspace.getVimSetting('version')
    expect(typeof version).toBe('string')
  })
})

describe('workspace utility', () => {

  it('should not create file if document exists', async () => {
    let doc = await helper.createDocument('foo')
    let filepath = URI.parse(doc.uri).fsPath
    await workspace.createFile(filepath, { ignoreIfExists: false })
    let exists = fs.existsSync(filepath)
    expect(exists).toBe(false)
  })

  it('should not create file if file exists with ignoreIfExists', async () => {
    let file = await createTmpFile('foo')
    await workspace.createFile(file, { ignoreIfExists: true })
    let content = fs.readFileSync(file, 'utf8')
    expect(content).toBe('foo')
  })

  it('should create file if not exists', async () => {
    let filepath = path.join(__dirname, 'foo')
    await workspace.createFile(filepath, { ignoreIfExists: true })
    let exists = fs.existsSync(filepath)
    expect(exists).toBe(true)
    fs.unlinkSync(filepath)
  })

  it('should create folder if not exists', async () => {
    let filepath = path.join(__dirname, 'bar/')
    await workspace.createFile(filepath)
    expect(fs.existsSync(filepath)).toBe(true)
    fs.rmdirSync(filepath)
  })

  it('should not throw on folder create if overwrite is true', async () => {
    let filepath = path.join(__dirname, 'bar/')
    await workspace.createFile(filepath)
    await workspace.createFile(filepath, { overwrite: true })
    expect(fs.existsSync(filepath)).toBe(true)
    fs.rmdirSync(filepath)
  })

  it('should rename if file not exists', async () => {
    let filepath = path.join(__dirname, 'foo')
    let newPath = path.join(__dirname, 'bar')
    await workspace.createFile(filepath)
    await workspace.renameFile(filepath, newPath)
    expect(fs.existsSync(newPath)).toBe(true)
    expect(fs.existsSync(filepath)).toBe(false)
    fs.unlinkSync(newPath)
  })

  it('should rename buffer if rename file loaded', async () => {
    let filepath = path.join(__dirname, 'old')
    await workspace.createFile(filepath, { overwrite: true })
    await writeFile(filepath, 'bar')
    let uri = URI.file(filepath).toString()
    await workspace.openResource(uri)
    await helper.wait(200)
    let line = await nvim.line
    expect(line).toBe('bar')
    let newFile = path.join(__dirname, 'bar')
    let newUri = URI.file(newFile).toString()
    await workspace.renameFile(filepath, newFile, { overwrite: true })
    await helper.wait(100)
    let old = workspace.getDocument(uri)
    expect(old).toBeFalsy()
    let doc = workspace.getDocument(newUri)
    expect(doc.uri).toBe(newUri)
  })

  it('should overwrite if file exists', async () => {
    let filepath = path.join(__dirname, 'foo')
    let newPath = path.join(__dirname, 'bar')
    await workspace.createFile(filepath)
    await workspace.createFile(newPath)
    await workspace.renameFile(filepath, newPath, { overwrite: true })
    expect(fs.existsSync(newPath)).toBe(true)
    expect(fs.existsSync(filepath)).toBe(false)
    fs.unlinkSync(newPath)
  })

  it('should delete file if exists', async () => {
    let filepath = path.join(__dirname, 'foo')
    await workspace.createFile(filepath)
    expect(fs.existsSync(filepath)).toBe(true)
    await workspace.deleteFile(filepath)
    expect(fs.existsSync(filepath)).toBe(false)
  })

  it('should delete folder if exists', async () => {
    let filepath = path.join(__dirname, 'foo/')
    await workspace.createFile(filepath)
    expect(fs.existsSync(filepath)).toBe(true)
    await workspace.deleteFile(filepath, { recursive: true })
    expect(fs.existsSync(filepath)).toBe(false)
  })

  it('should open resource', async () => {
    let uri = URI.file(path.join(__dirname, 'bar')).toString()
    await workspace.openResource(uri)
    let buf = await nvim.buffer
    let name = await buf.name
    expect(name).toMatch('bar')
  })

  it('should open none file uri', async () => {
    let uri = 'jdi://abc'
    await workspace.openResource(uri)
    let buf = await nvim.buffer
    let name = await buf.name
    expect(name).toBe('jdi://abc')
  })

  it('should open opened buffer', async () => {
    let buf = await helper.edit('foo')
    let doc = workspace.getDocument(buf.id)
    await workspace.openResource(doc.uri)
    await helper.wait(30)
    let bufnr = await nvim.call('bufnr', '%')
    expect(bufnr).toBe(buf.id)
  })

  it('should open url', async () => {
    await helper.mockFunction('coc#util#open_url', 0)
    let buf = await helper.edit('foo')
    let uri = 'http://example.com'
    await workspace.openResource(uri)
    await helper.wait(30)
    let bufnr = await nvim.call('bufnr', '%')
    expect(bufnr).toBe(buf.id)
  })

  it('should create outputChannel', () => {
    let channel = workspace.createOutputChannel('channel')
    expect(channel.name).toBe('channel')
  })

  it('should show outputChannel', async () => {
    workspace.createOutputChannel('channel')
    workspace.showOutputChannel('channel')
    await helper.wait(200)
    let buf = await nvim.buffer
    let name = await buf.name
    expect(name).toMatch('[coc channel]')
  })

  it('should not show none exists channel', async () => {
    let buf = await nvim.buffer
    let bufnr = buf.id
    workspace.showOutputChannel('NONE')
    await helper.wait(100)
    buf = await nvim.buffer
    expect(buf.id).toBe(bufnr)
  })

  it('should get current state', async () => {
    let buf = await helper.edit('bar')
    await buf.setLines(['foo', 'bar'], { start: 0, end: -1, strictIndexing: false })
    await nvim.call('cursor', [2, 2])
    let doc = workspace.getDocument(buf.id)
    let state = await workspace.getCurrentState()
    expect(doc.uri).toBe(state.document.uri)
    expect(state.position).toEqual({ line: 1, character: 1 })
  })

  it('should jumpTo position', async () => {
    let uri = URI.file('/tmp/foo').toString()
    await workspace.jumpTo(uri, { line: 1, character: 1 })
    let buf = await nvim.buffer
    let name = await buf.name
    expect(name).toMatch('/foo')
    await buf.setLines(['foo', 'bar'], { start: 0, end: -1, strictIndexing: false })
    await workspace.jumpTo(uri, { line: 1, character: 1 })
    let pos = await nvim.call('getcurpos')
    expect(pos[1]).toBe(2)
    expect(pos[2]).toBe(2)
  })

  it('should jumpTo custom uri scheme', async () => {
    let uri = 'jdt://foo'
    await workspace.jumpTo(uri, { line: 1, character: 1 })
    let buf = await nvim.buffer
    let name = await buf.name
    expect(name).toBe(uri)
  })

  it('should findUp to tsconfig.json from cwd', async () => {
    let filepath = await workspace.findUp('tsconfig.json')
    expect(filepath).toMatch('tsconfig.json')
  })

  it('should findUp from current file ', async () => {
    await helper.edit('foo')
    let filepath = await workspace.findUp('tsconfig.json')
    expect(filepath).toMatch('tsconfig.json')
  })

  it('should choose quickpick', async () => {
    let p = workspace.showQuickpick(['a', 'b'])
    await helper.wait(100)
    let m = await nvim.mode
    expect(m.blocking).toBe(true)
    await nvim.input('1<enter>')
    let res = await p
    expect(res).toBe(0)
    await nvim.input('<enter>')
  })

  it('should cancel quickpick', async () => {
    let p = workspace.showQuickpick(['a', 'b'])
    await helper.wait(100)
    let m = await nvim.mode
    expect(m.blocking).toBe(true)
    await nvim.input('8<enter>')
    let res = await p
    expect(res).toBe(-1)
    await nvim.input('<enter>')
  })

  it('should show prompt', async () => {
    let p = workspace.showPrompt('prompt')
    await helper.wait(100)
    await nvim.input('y')
    let res = await p
    expect(res).toBe(true)
  })

  it('should request input', async () => {
    let p = workspace.requestInput('name')
    await helper.wait(100)
    await nvim.input('bar<enter>')
    let res = await p
    expect(res).toBe('bar')
  })

  it('should return null when input empty', async () => {
    let p = workspace.requestInput('name')
    await helper.wait(100)
    await nvim.input('<enter>')
    let res = await p
    expect(res).toBeNull()
  })
})

describe('workspace events', () => {

  it('should listen to fileType change', async () => {
    let buf = await helper.edit('foo')
    await nvim.command('setf xml')
    await helper.wait(40)
    let doc = workspace.getDocument(buf.id)
    expect(doc.filetype).toBe('xml')
  })

  it('should listen optionSet', async () => {
    let opt = workspace.completeOpt
    expect(opt).toMatch('menuone')
    await nvim.command('set completeopt=menu,preview')
    await helper.wait(100)
    opt = workspace.completeOpt
    expect(opt).toBe('menu,preview')
  })

  it('should fire onDidOpenTextDocument', async () => {
    let fn = jest.fn()
    workspace.onDidOpenTextDocument(fn, null, disposables)
    await helper.edit('tmp')
    await helper.wait(30)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('should fire onDidCloseTextDocument', async () => {
    let fn = jest.fn()
    await helper.edit('tmp')
    workspace.onDidCloseTextDocument(fn, null, disposables)
    await nvim.command('bd!')
    await helper.wait(100)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('should fire onDidChangeTextDocument', async () => {
    let fn = jest.fn()
    await helper.edit('tmp')
    workspace.onDidChangeTextDocument(fn, null, disposables)
    await nvim.setLine('foo')
    let doc = await workspace.document
    doc.forceSync()
    await helper.wait(20)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('should fire onDidChangeConfiguration', async () => {
    await helper.createDocument('onDidChangeConfiguration')
    let fn = jest.fn()
    let disposable = workspace.onDidChangeConfiguration(e => {
      disposable.dispose()
      expect(e.affectsConfiguration('tsserver')).toBe(true)
      expect(e.affectsConfiguration('tslint')).toBe(false)
      fn()
    })
    let config = workspace.getConfiguration('tsserver')
    config.update('enable', false)
    await helper.wait(2000)
    expect(fn).toHaveBeenCalledTimes(1)
    config.update('enable', undefined)
  })

  it('should fire onWillSaveUntil', async () => {
    await helper.createDocument('willSaveHandler')
    let fn = jest.fn()
    workspace.onWillSaveUntil(event => {
      let promise = new Promise<void>(resolve => {
        fn()
        nvim.command('normal! dd').then(resolve, resolve)
      })
      event.waitUntil(promise)
    }, null, 'test')
    let file = await createTmpFile('tmp')
    await helper.edit(file)
    await nvim.command('w')
    expect(fn).toHaveBeenCalledTimes(1)
    fs.unlinkSync(file)
  })

  it('should attach & detach', async () => {
    let buf = await helper.edit('foo')
    await nvim.command('CocDisable')
    await helper.wait(100)
    let doc = workspace.getDocument(buf.id)
    expect(doc).toBeUndefined()
    await nvim.command('CocEnable')
    await helper.wait(100)
    doc = workspace.getDocument(buf.id)
    expect(doc.bufnr).toBe(buf.id)
  })
})

describe('workspace private', () => {

  it('should init vim events', async () => {
    let buf = await helper.edit('foo')
    await buf.detach()
    let attached = buf.isAttached
    expect(attached).toBe(false)
    let doc = workspace.getDocument(buf.id)
      ; (doc as any).env.isVim = true
      ; (workspace as any).initVimEvents()
    await nvim.setLine('abc')
    await helper.wait(300)
    expect(doc.content).toMatch('abc')
    await nvim.input('Adef')
    await nvim.call('coc#_hide')
    await helper.wait(100)
    expect(doc.getline(0)).toMatch('abcdef')
  })

  it('should show errors', async () => {
    let errors: ErrorItem[] = []
    errors.push({
      location: Location.create('/tmp/foo', Range.create(0, 0, 0, 0)),
      message: 'error'
    })
    await (workspace as any).showErrors(errors)
    let res = await nvim.call('getqflist') as any
    expect(res.length).toBe(1)
  })
})

describe('workspace textDocument content provider', () => {

  it('should regist document content provider', async () => {
    let provider: TextDocumentContentProvider = {
      provideTextDocumentContent: (_uri, _token): string => {
        return 'sample text'
      }
    }
    workspace.registerTextDocumentContentProvider('test', provider)
    await helper.wait(80)
    await nvim.command('edit test://1')
    let buf = await nvim.buffer
    let lines = await buf.lines
    expect(lines).toEqual(['sample text'])
  })

  it('should react onChagne event of document content provider', async () => {
    let text = 'foo'
    let emitter = new Emitter<URI>()
    let event = emitter.event
    let provider: TextDocumentContentProvider = {
      onDidChange: event,
      provideTextDocumentContent: (_uri, _token): string => {
        return text
      }
    }
    workspace.registerTextDocumentContentProvider('jdk', provider)
    await helper.wait(80)
    await nvim.command('edit jdk://1')
    await helper.wait(100)
    text = 'bar'
    emitter.fire(URI.parse('jdk://1'))
    await helper.wait(200)
    let buf = await nvim.buffer
    let lines = await buf.lines
    expect(lines).toEqual(['bar'])
  })
})
