import {Neovim} from 'neovim'
import {
  echoWarning,
  echoMessage,
  echoErr,
} from './util/'
import {
  Disposable
} from 'vscode-languageserver-protocol'
import {
  IServiceProvider,
  ServiceStat,
} from './types'
import tsserverService from './typescript-service'
const logger = require('./util/logger')('services')

interface ServiceInfo {
  name: string
  state: string
  languageIds: string[]
}

function getStateName(state:ServiceStat):string {
  switch (state) {
    case ServiceStat.Init:
      return 'init'
    case ServiceStat.Restarting:
      return 'restarting'
    case ServiceStat.Running:
      return 'running'
    case ServiceStat.Starting:
      return 'starting'
    case ServiceStat.Stopped:
      return 'stopped'
    default:
      return 'unknown'
  }
  
}

export class ServiceManager implements Disposable {

  private nvim:Neovim
  private languageIds: Set<string> = new Set()
  private readonly registed: Map<string, IServiceProvider> = new Map()

  public init(nvim:Neovim):void {
    this.nvim = nvim
    this.regist(new tsserverService())
    // TODO regist more services
  }

  public dispose():void {
    for (let service of this.registed.values()) {
      service.dispose()
    }
  }

  public regist(service:IServiceProvider): void {
    let {name, languageIds} = service
    if (this.registed.get(name)) {
      echoErr(this.nvim, `Service ${name} already exists`).catch(_e => {
        //noop
      })
      return
    }
    this.registed.set(name, service)
    languageIds.forEach(lang => {
      this.languageIds.add(lang)
    })
    service.onServiceReady(async () => {
      await echoMessage(this.nvim, `service ${name} started`)
    })
  }

  private checkProvider(languageId:string, warning = false):boolean {
    if (!languageId) return false
    if (!this.languageIds.has(languageId)) {
      if (warning) {
        echoWarning(this.nvim, `service not found for ${languageId}`) // tslint:disable-line
      }
      return false
    }
    return true
  }

  public getServices(languageId:string):IServiceProvider[] {
    if (!this.checkProvider(languageId)) return
    let res:IServiceProvider[] = []
    for (let service of this.registed.values()) {
      if (service.languageIds.indexOf(languageId) !== -1) {
        res.push(service)
      }
    }
    return res
  }

  public start(languageId:string):void {
    if (!this.checkProvider(languageId)) return
    let services = this.getServices(languageId)
    for (let service of services) {
      let {state} = service
      if (state === ServiceStat.Init || state === ServiceStat.Stopped) {
        service.init()
      }
    }
  }

  public async restart(name:string):Promise<void> {
    let service = this.registed.get(name)
    if (!service) {
      echoErr(this.nvim, `Service ${name} not found`).catch(_e => {})
      return
    }
    await Promise.resolve(service.restart())
  }

  public getServiceStats():ServiceInfo[] {
    let res:ServiceInfo[] = []
    for (let [name, service] of this.registed) {
      res.push({
        name,
        languageIds: service.languageIds,
        state: getStateName(service.state)
      })
    }
    return res
  }
}

export default new ServiceManager()