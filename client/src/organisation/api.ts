import type { Store, CreateStoreRequest, UpdateStoreRequest } from '@gwc/contracts/stores'
import type {
  MerchantOffer, CreateOfferRequest, UpdateOfferRequest, OfferCategory,
} from '@gwc/contracts/offers'
import { get, post, patch, put, del } from '../lib/api'

/**
 * A merchant's own store and offers (feature 035), typed from the shared
 * contracts so a field renamed on the server is a type error here.
 *
 * Every path is "mine": the organisation is read from the session on the
 * server, so there is no id of an organisation to send, and nothing here can be
 * pointed at someone else's store.
 */
export const merchantApi = {
  store: () => get('/merchant/store') as Promise<Store>,
  createStore: (body: CreateStoreRequest) => post('/merchant/store', body) as Promise<Store>,
  updateStore: (body: UpdateStoreRequest) => patch('/merchant/store', body) as Promise<Store>,
  setCover: (assetId: string | null) => put('/merchant/store/cover', { assetId }) as Promise<Store>,
  setStoreMedia: (assetIds: string[]) => put('/merchant/store/media', { assetIds }) as Promise<Store>,

  offers: () => get('/merchant/offers') as Promise<{ items: MerchantOffer[] }>,
  createOffer: (body: CreateOfferRequest) => post('/merchant/offers', body) as Promise<MerchantOffer>,
  updateOffer: (id: string, body: UpdateOfferRequest) => patch(`/merchant/offers/${id}`, body) as Promise<MerchantOffer>,
  setOfferMedia: (id: string, assetIds: string[]) => put(`/merchant/offers/${id}/media`, { assetIds }) as Promise<MerchantOffer>,
  publish: (id: string) => post(`/merchant/offers/${id}/publish`) as Promise<MerchantOffer>,
  withdraw: (id: string) => post(`/merchant/offers/${id}/withdraw`) as Promise<MerchantOffer>,
  categories: () => get('/merchant/categories') as Promise<{ items: OfferCategory[] }>,

  /**
   * Free a file nothing uses. Best effort and quiet: a file still in use is
   * refused (409), and that is the right answer, not something to show.
   */
  deleteFile: (assetId: string) => del(`/media/merchant/${assetId}`),
}
