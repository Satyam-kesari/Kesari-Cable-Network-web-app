import { whatsappLink } from '../lib.js';

export default function WhatsAppLink({ phone, message = '', label, showLabel = false }) {
  return <a className={`${showLabel ? 'button' : 'icon-button'} whatsapp-link`} href={whatsappLink(phone, message)} target="_blank" rel="noopener noreferrer" title={label} aria-label={label}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path fill="currentColor" d="M12 2a10 10 0 0 0-8.65 15.02L2 22l5.12-1.34A10 10 0 1 0 12 2Z"/>
      <path fill="#fff" d="M8.13 6.65c-.2-.46-.42-.47-.62-.48h-.53c-.18 0-.48.07-.73.34s-.96.94-.96 2.29 1 2.66 1.14 2.84 1.94 2.96 4.71 4.15c.66.28 1.18.45 1.58.58.66.21 1.26.18 1.73.11.53-.08 1.62-.66 1.85-1.3.23-.65.23-1.2.16-1.31s-.25-.18-.52-.32-1.62-.8-1.87-.89-.43-.14-.62.14-.71.89-.87 1.07-.32.21-.6.07-1.16-.43-2.21-1.37c-.82-.73-1.37-1.64-1.53-1.92s-.02-.42.12-.56c.12-.12.27-.32.41-.48s.18-.27.27-.46.05-.34-.02-.48-.61-1.5-.87-2.12Z"/>
    </svg>
    {showLabel && 'WhatsApp'}
  </a>;
}
