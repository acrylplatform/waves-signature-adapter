import { Adapter } from './Adapter';
import { AdapterType } from '../config';
import { SIGN_TYPE, TSignData } from '../prepareTx';
import { utils } from '@waves/signature-generator';

export class WavesKeeperAdapter extends Adapter {

    public static type = AdapterType.WavesKeeper;
    public static adapter: WavesKeeperAdapter;
    private static _onUpdateCb: Array<(...args) => any> = [];
    private _onDestoryCb = [];
    private _needDestroy = false;
    private _address: string;
    private _pKey: string;
    private static _getApiCb: () => IWavesKeeper;
    
    private static _api: IWavesKeeper;

    constructor( { address, publicKey }) {
        super();
        WavesKeeperAdapter._initExtension();
        this._address = address;
        this._pKey = publicKey;

        WavesKeeperAdapter.onUpdate((state) => {
            if (!state.locked && (!state.account || state.account.address !== this._address)) {
                this._needDestroy = true;
                this._onDestoryCb.forEach(cb => cb());
            }
        });
    }

    public async isAvailable(ignoreLocked = false): Promise<void> {
        try {
            await WavesKeeperAdapter.isAvailable();
            const data = await WavesKeeperAdapter._api.publicState();
            
            if (data.locked) {
                return ignoreLocked ? Promise.resolve() : Promise.reject({ code: 4, msg: 'Keeper is locked' });
            }
            
            if (data.account && data.account.address === this._address) {
                return Promise.resolve();
            }
        } catch (e) {
        }

        return Promise.reject({ code: 5, msg: 'Keeper has another active account' });
    }
    
    public async isLocked() {
        await WavesKeeperAdapter.isAvailable();
        const data = await WavesKeeperAdapter._api.publicState();
        
        if (data.locked) {
            return Promise.resolve();
        }
    }
    
    public onDestroy(cb) {
        if (this._needDestroy) {
            return cb();
        }

        this._onDestoryCb.push(cb);
    }
    
    public getPublicKey() {
        return Promise.resolve(this._pKey);
    }

    public getAddress() {
        return Promise.resolve(this._address);
    }

    public getSeed() {
        return Promise.reject(Error('Method "getSeed" is not available!'));
    }

    public async signRequest(bytes: Uint8Array, _?, signData?): Promise<string> {
        await this.isAvailable(true);
        return await WavesKeeperAdapter._api.signRequest(signData);
    }

    public async signTransaction(bytes: Uint8Array, amountPrecision: number, signData): Promise<string> {
        await this.isAvailable(true);
        const dataStr = await WavesKeeperAdapter._api.signTransaction(signData);
        const { proofs, signature } = JSON.parse(dataStr);
        return signature || proofs.pop();
    }

    public async signOrder(bytes: Uint8Array, amountPrecision: number, signData): Promise<string> {
        await this.isAvailable(true);
        let promise;
        switch (signData.type) {
            case SIGN_TYPE.CREATE_ORDER:
                promise = WavesKeeperAdapter._api.signOrder(signData);
                break;
            case SIGN_TYPE.CANCEL_ORDER:
                promise = WavesKeeperAdapter._api.signCancelOrder(signData);
                break;
            default:
                return WavesKeeperAdapter._api.signRequest(signData);
        }

        const dataStr = await promise;
        const { proofs, signature } = JSON.parse(dataStr);
        return signature || proofs.pop();
    }

    public async signData(bytes: Uint8Array): Promise<string> {
        await this.isAvailable(true);
        return Promise.resolve(''); //TODO
    }

    public getPrivateKey() {
        return Promise.reject('No private key');
    }

    public static async isAvailable() {
        WavesKeeperAdapter._initExtension();
        
        if (!this._api) {
            throw { code: 0, message: 'Install WavesKeeper' };
        }

        let error, data;
        try {
            data = await this._api.publicState();
        } catch (e) {
            error = { code: 1, message: 'No permissions' }
        }

        if (!error && data) {
            if (!data.locked && !data.account) {
                error = { code: 2, message: 'No accounts in waveskeeper' };
            } else if (!data.locked && (!data.account.address || !utils.crypto.isValidAddress(data.account.address))) {
                error = { code: 3, message: 'Selected network incorrect' };
            }
        }

        if (error) {
            throw error;
        }

        return true;
    }

    public static async getUserList() {
        await WavesKeeperAdapter.isAvailable();
        return WavesKeeperAdapter._api.publicState().then(({ account }) => [account]);
    }

    public static initOptions(options) {
        Adapter.initOptions(options);
        this.setApiExtension(options.extension);
    }

    public static setApiExtension(extension) {
        
        let extensionCb;
        
        if (typeof extension === 'function') {
            extensionCb = extension;
        } else if (extension) {
            extensionCb = () => extension;
        }
        
        WavesKeeperAdapter._getApiCb = extensionCb;
    }
    
    public static onUpdate(cb) {
        WavesKeeperAdapter._onUpdateCb.push(cb);
    }
    
    
    private static _initExtension() {
        if (WavesKeeperAdapter._api || !WavesKeeperAdapter._getApiCb) {
            return null;
        }
        
        this._api = WavesKeeperAdapter._getApiCb();
    
        if (this._api) {
            this._api.on('update', (state) => {
                for (const cb of WavesKeeperAdapter._onUpdateCb) {
                    cb(state);
                }
            });
        }
    }
}


interface IWavesKeeper {
    auth: (data: IAuth) => Promise<IAuthData>;
    signTransaction: (data: TSignData) => Promise<any>;
    signOrder: (data) => Promise<any>;
    signCancelOrder: (data) => Promise<any>;
    signRequest: (data) => Promise<string>;
    signBytes: (data) => Promise<string>;
    publicState: () => Promise<any>;
    on: (name: string, cb) => Promise<any>;
}

interface IAuth {
    data: string;
    name: string;
    icon?: string;
    successPath?: string;
}

interface IAuthData {
    address: string;
    data: string;
    host: string;
    prefix: string;
    publicKey: string;
    signature: string;
}
