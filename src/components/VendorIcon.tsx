import React from 'react';

interface VendorIconProps {
  vendor: string;
  size?: number;
  style?: React.CSSProperties;
}

/**
 * Vendor icon component with support for multiple providers.
 * Uses SVG for logos that can be replaced with actual brand assets.
 */
export const VendorIcon: React.FC<VendorIconProps> = ({ vendor, size = 16, style }) => {
  const vendorLower = vendor.toLowerCase();
  const iconSize = size;
  
  // Base styles for all icons
  const baseStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: `${iconSize}px`,
    height: `${iconSize}px`,
    lineHeight: 1,
    ...style
  };

  // OpenAI logo from saved SVG file
  const OpenAILogo = () => (
    <svg
      width={iconSize}
      height={iconSize}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      style={{ ...baseStyle, color: '#10A37F' }}
    >
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/>
    </svg>
  );

  // Claude/Anthropic logo - simplified
  const ClaudeLogo = () => (
    <svg
      width={iconSize}
      height={iconSize}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={baseStyle}
    >
      <rect
        x="4"
        y="4"
        width="16"
        height="16"
        rx="3"
        fill="#D4A574"
        stroke="#B8945F"
        strokeWidth="1.5"
      />
      <path
        d="M8 12L12 8L16 12L12 16L8 12Z"
        fill="white"
        opacity="0.9"
      />
    </svg>
  );

  // Gemini logo - simplified
  const GeminiLogo = () => (
    <svg
      width={iconSize}
      height={iconSize}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={baseStyle}
    >
      <path
        d="M12 4L6 10L12 16L18 10L12 4Z"
        fill="#4285F4"
        stroke="#1A73E8"
        strokeWidth="1.5"
      />
      <path
        d="M12 8L8 12L12 16L16 12L12 8Z"
        fill="white"
        opacity="0.8"
      />
    </svg>
  );

  // Grok/X.AI logo - simplified
  const GrokLogo = () => (
    <svg
      width={iconSize}
      height={iconSize}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={baseStyle}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="#000000"
        stroke="#333333"
        strokeWidth="1.5"
      />
      <path
        d="M9 12L12 9L15 12L12 15L9 12Z"
        fill="white"
        opacity="0.9"
      />
    </svg>
  );

  // Render appropriate icon based on vendor
  switch (vendorLower) {
    case 'chatgpt':
    case 'openai':
      return <OpenAILogo />;
    case 'claude':
    case 'anthropic':
      return <ClaudeLogo />;
    case 'gemini':
    case 'google':
    case 'bard':
      return <GeminiLogo />;
    case 'grok':
    case 'xai':
      return <GrokLogo />;
    default:
      // Fallback to simple chat icon
      return (
        <span style={{ ...baseStyle, fontSize: `${iconSize}px` }}>💬</span>
      );
  }
};

