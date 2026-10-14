/** crypto.randomUUID() は HTTP（localhost以外）では使えないため、単純なカウンタ+乱数で代用 */
let seq = 0
export const uid = () => `${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`
