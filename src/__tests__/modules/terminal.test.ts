import { Neovim } from '@chemzqm/neovim'
import path from 'path'
import Terminal from '../../model/terminal'
import { createNvim } from '../../util'
import workspace from '../../workspace'

let nvim: Neovim
beforeEach(async () => {
  nvim = createNvim()
  let p = path.join(workspace.pluginRoot, 'autoload/coc/util.vim')
  await nvim.command(`source ${p}`)
})

afterEach(() => {
  nvim.quit()
})

describe('terminal', () => {

  test('terminal.resolveModule()', async () => {
    let t = new Terminal(nvim)
    let res = await t.resolveModule('typescript')
    expect(typeof res).toBe('string')
  })
})
