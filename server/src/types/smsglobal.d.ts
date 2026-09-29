/** The `smsglobal` SDK ships no types; this is the one factory integrations/sms.ts uses. */
declare module 'smsglobal' {
  const smsglobal: (apiKey: string, apiSecret: string) => unknown
  export default smsglobal
}
