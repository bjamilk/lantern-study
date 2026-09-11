/**
 * Every icon the app can draw, by the app's own name.
 *
 * WHY THIS FILE EXISTS
 * The app drew ~700 icons from a glyph FONT, which has no stroke control, so
 * "make the outlines bolder" was not expressible at all. These are real SVG
 * paths, so stroke weight is a prop — see appIconStroke.ts, which owns it.
 *
 * WHY DEEP IMPORTS
 * One import per icon, from 'lucide-react-native/icons/<file>', never from the
 * package root. Metro does not tree-shake by default, so one named import off
 * the root barrel would pull all ~1800 icon modules (15MB of source) into the
 * bundle. Deep imports bundle exactly the 163 glyphs below.
 *
 * WHY THESE NAMES
 * They are the app's own vocabulary, not lucide's: the old glyph names with
 * `-outline` stripped. lucide has no outline/solid split — every icon is a
 * stroke, and a solid one is the same icon with `filled` — so `heart` plus
 * `filled` replaces what used to be `heart` / `heart-outline`.
 *
 * There is deliberately NO string-keyed fallback. An unmapped name has to be a
 * TypeScript error; a runtime fallback is how an icon silently becomes a blank
 * square in production — which it already had: 'cookie-outline' and a stale
 * badge name were both shipping as nothing until this map made them fail to
 * compile.
 */
import AlarmClock from 'lucide-react-native/icons/alarm-clock';
import Archive from 'lucide-react-native/icons/archive';
import ArrowDown from 'lucide-react-native/icons/arrow-down';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import ArrowLeftRight from 'lucide-react-native/icons/arrow-left-right';
import ArrowRight from 'lucide-react-native/icons/arrow-right';
import ArrowUp from 'lucide-react-native/icons/arrow-up';
import AtSign from 'lucide-react-native/icons/at-sign';
import Award from 'lucide-react-native/icons/award';
import Ban from 'lucide-react-native/icons/ban';
import Banknote from 'lucide-react-native/icons/banknote';
import Bell from 'lucide-react-native/icons/bell';
import BellOff from 'lucide-react-native/icons/bell-off';
import Book from 'lucide-react-native/icons/book';
import Bookmark from 'lucide-react-native/icons/bookmark';
import Briefcase from 'lucide-react-native/icons/briefcase';
import Building2 from 'lucide-react-native/icons/building-2';
import Calendar from 'lucide-react-native/icons/calendar';
import Camera from 'lucide-react-native/icons/camera';
import Car from 'lucide-react-native/icons/car';
import ChartColumn from 'lucide-react-native/icons/chart-column';
import ChartLine from 'lucide-react-native/icons/chart-line';
import ChartPie from 'lucide-react-native/icons/chart-pie';
import Check from 'lucide-react-native/icons/check';
import CheckCheck from 'lucide-react-native/icons/check-check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import ChevronUp from 'lucide-react-native/icons/chevron-up';
import Circle from 'lucide-react-native/icons/circle';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import CircleCheck from 'lucide-react-native/icons/circle-check';
import CircleDot from 'lucide-react-native/icons/circle-dot';
import CircleMinus from 'lucide-react-native/icons/circle-minus';
import CirclePause from 'lucide-react-native/icons/circle-pause';
import CirclePlay from 'lucide-react-native/icons/circle-play';
import CirclePlus from 'lucide-react-native/icons/circle-plus';
import CircleQuestionMark from 'lucide-react-native/icons/circle-question-mark';
import CircleStop from 'lucide-react-native/icons/circle-stop';
import CircleUser from 'lucide-react-native/icons/circle-user';
import CircleX from 'lucide-react-native/icons/circle-x';
import ClipboardList from 'lucide-react-native/icons/clipboard-list';
import Clock from 'lucide-react-native/icons/clock';
import CloudCheck from 'lucide-react-native/icons/cloud-check';
import CloudDownload from 'lucide-react-native/icons/cloud-download';
import CloudOff from 'lucide-react-native/icons/cloud-off';
import CloudUpload from 'lucide-react-native/icons/cloud-upload';
import Contrast from 'lucide-react-native/icons/contrast';
import Cookie from 'lucide-react-native/icons/cookie';
import Copy from 'lucide-react-native/icons/copy';
import CreditCard from 'lucide-react-native/icons/credit-card';
import Download from 'lucide-react-native/icons/download';
import Ellipsis from 'lucide-react-native/icons/ellipsis';
import EllipsisVertical from 'lucide-react-native/icons/ellipsis-vertical';
import ExternalLink from 'lucide-react-native/icons/external-link';
import Eye from 'lucide-react-native/icons/eye';
import EyeOff from 'lucide-react-native/icons/eye-off';
import File from 'lucide-react-native/icons/file';
import FileText from 'lucide-react-native/icons/file-text';
import Flag from 'lucide-react-native/icons/flag';
import Flame from 'lucide-react-native/icons/flame';
import FlaskConical from 'lucide-react-native/icons/flask-conical';
import Folder from 'lucide-react-native/icons/folder';
import Frown from 'lucide-react-native/icons/face-slightly-frowning';
import Funnel from 'lucide-react-native/icons/funnel';
import Gamepad2 from 'lucide-react-native/icons/gamepad-2';
import Gift from 'lucide-react-native/icons/gift';
import GitBranch from 'lucide-react-native/icons/git-branch';
import GitCompare from 'lucide-react-native/icons/git-compare';
import Globe from 'lucide-react-native/icons/globe';
import GraduationCap from 'lucide-react-native/icons/graduation-cap';
import Handshake from 'lucide-react-native/icons/handshake';
import HardDrive from 'lucide-react-native/icons/hard-drive';
import Headphones from 'lucide-react-native/icons/headphones';
import Heart from 'lucide-react-native/icons/heart';
import House from 'lucide-react-native/icons/house';
import Image from 'lucide-react-native/icons/image';
import Images from 'lucide-react-native/icons/images';
import Infinity from 'lucide-react-native/icons/infinity';
import Info from 'lucide-react-native/icons/info';
import Layers from 'lucide-react-native/icons/layers';
import Layers2 from 'lucide-react-native/icons/layers-2';
import LayoutGrid from 'lucide-react-native/icons/layout-grid';
import Library from 'lucide-react-native/icons/library';
import Lightbulb from 'lucide-react-native/icons/lightbulb';
import Link from 'lucide-react-native/icons/link';
import List from 'lucide-react-native/icons/list';
import Lock from 'lucide-react-native/icons/lock';
import LogOut from 'lucide-react-native/icons/log-out';
import Mail from 'lucide-react-native/icons/mail';
import MailPlus from 'lucide-react-native/icons/mail-plus';
import MapPin from 'lucide-react-native/icons/map-pin';
import Maximize2 from 'lucide-react-native/icons/maximize-2';
import Medal from 'lucide-react-native/icons/medal';
import Megaphone from 'lucide-react-native/icons/megaphone';
import Menu from 'lucide-react-native/icons/menu';
import MessageCircle from 'lucide-react-native/icons/message-circle';
import MessageCircleMore from 'lucide-react-native/icons/message-circle-more';
import MessagesSquare from 'lucide-react-native/icons/messages-square';
import Mic from 'lucide-react-native/icons/mic';
import Minus from 'lucide-react-native/icons/minus';
import Moon from 'lucide-react-native/icons/moon';
import Network from 'lucide-react-native/icons/network';
import Package from 'lucide-react-native/icons/package';
import Palette from 'lucide-react-native/icons/palette';
import Paperclip from 'lucide-react-native/icons/paperclip';
import Pause from 'lucide-react-native/icons/pause';
import Pencil from 'lucide-react-native/icons/pencil';
import Pin from 'lucide-react-native/icons/pin';
import Play from 'lucide-react-native/icons/play';
import Plus from 'lucide-react-native/icons/plus';
import Presentation from 'lucide-react-native/icons/presentation';
import Receipt from 'lucide-react-native/icons/receipt';
import Redo2 from 'lucide-react-native/icons/redo-2';
import RefreshCcw from 'lucide-react-native/icons/refresh-ccw';
import RefreshCw from 'lucide-react-native/icons/refresh-cw';
import Repeat from 'lucide-react-native/icons/repeat';
import Rocket from 'lucide-react-native/icons/rocket';
import Save from 'lucide-react-native/icons/save';
import Search from 'lucide-react-native/icons/search';
import Send from 'lucide-react-native/icons/send';
import Settings from 'lucide-react-native/icons/settings';
import Share2 from 'lucide-react-native/icons/share-2';
import Shield from 'lucide-react-native/icons/shield';
import ShieldCheck from 'lucide-react-native/icons/shield-check';
import Shirt from 'lucide-react-native/icons/shirt';
import ShoppingBag from 'lucide-react-native/icons/shopping-bag';
import ShoppingCart from 'lucide-react-native/icons/shopping-cart';
import Shuffle from 'lucide-react-native/icons/shuffle';
import SignalHigh from 'lucide-react-native/icons/signal-high';
import SlidersHorizontal from 'lucide-react-native/icons/sliders-horizontal';
import Smartphone from 'lucide-react-native/icons/smartphone';
import Snowflake from 'lucide-react-native/icons/snowflake';
import Sparkle from 'lucide-react-native/icons/sparkle';
import Sparkles from 'lucide-react-native/icons/sparkles';
import Square from 'lucide-react-native/icons/square';
import SquareCheckBig from 'lucide-react-native/icons/square-check-big';
import SquarePen from 'lucide-react-native/icons/square-pen';
import SquarePlay from 'lucide-react-native/icons/square-play';
import Star from 'lucide-react-native/icons/star';
import StarHalf from 'lucide-react-native/icons/star-half';
import Store from 'lucide-react-native/icons/store';
import Sun from 'lucide-react-native/icons/sun';
import Tag from 'lucide-react-native/icons/tag';
import Tags from 'lucide-react-native/icons/tags';
import ThumbsDown from 'lucide-react-native/icons/thumbs-down';
import ThumbsUp from 'lucide-react-native/icons/thumbs-up';
import Ticket from 'lucide-react-native/icons/ticket';
import Timer from 'lucide-react-native/icons/timer';
import Trash from 'lucide-react-native/icons/trash';
import TrendingUp from 'lucide-react-native/icons/trending-up';
import TriangleAlert from 'lucide-react-native/icons/triangle-alert';
import Trophy from 'lucide-react-native/icons/trophy';
import Type from 'lucide-react-native/icons/type';
import Undo2 from 'lucide-react-native/icons/undo-2';
import User from 'lucide-react-native/icons/user';
import UserPlus from 'lucide-react-native/icons/user-plus';
import Users from 'lucide-react-native/icons/users';
import UtensilsCrossed from 'lucide-react-native/icons/utensils-crossed';
import Volume2 from 'lucide-react-native/icons/volume-2';
import VolumeX from 'lucide-react-native/icons/volume-x';
import Wallet from 'lucide-react-native/icons/wallet';
import Wifi from 'lucide-react-native/icons/wifi';
import X from 'lucide-react-native/icons/x';
import Zap from 'lucide-react-native/icons/zap';

export const APP_ICONS = {
  'add': Plus,
  'add-circle': CirclePlus,
  'alarm': AlarmClock,
  'albums': Layers2,
  'alert-circle': CircleAlert,
  'analytics': ChartLine,
  'apps': LayoutGrid,
  'archive': Archive,
  'arrow-back': ArrowLeft,
  'arrow-down': ArrowDown,
  'arrow-forward': ArrowRight,
  'arrow-redo': Redo2,
  'arrow-undo': Undo2,
  'arrow-up': ArrowUp,
  'at': AtSign,
  'bag': ShoppingBag,
  'bag-handle': ShoppingBag,
  'ban': Ban,
  'bar-chart': ChartColumn,
  'book': Book,
  'bookmark': Bookmark,
  'briefcase': Briefcase,
  'bulb': Lightbulb,
  'business': Building2,
  'calendar': Calendar,
  'camera': Camera,
  'car': Car,
  'card': CreditCard,
  'cart': ShoppingCart,
  'cash': Banknote,
  'cellular': SignalHigh,
  'chatbubble': MessageCircle,
  'chatbubble-ellipses': MessageCircleMore,
  'chatbubbles': MessagesSquare,
  'checkbox': SquareCheckBig,
  'checkmark': Check,
  'checkmark-circle': CircleCheck,
  'checkmark-done': CheckCheck,
  'chevron-back': ChevronLeft,
  'chevron-down': ChevronDown,
  'chevron-forward': ChevronRight,
  'chevron-up': ChevronUp,
  'clipboard': ClipboardList,
  'close': X,
  'close-circle': CircleX,
  'cloud-done': CloudCheck,
  'cloud-download': CloudDownload,
  'cloud-offline': CloudOff,
  'cloud-upload': CloudUpload,
  'color-palette': Palette,
  'contrast': Contrast,
  'cookie': Cookie,
  'copy': Copy,
  'create': SquarePen,
  'cube': Package,
  'document': File,
  'document-attach': Paperclip,
  'document-text': FileText,
  'download': Download,
  'easel': Presentation,
  'ellipse': Circle,
  'ellipsis-horizontal': Ellipsis,
  'ellipsis-vertical': EllipsisVertical,
  'exit': LogOut,
  'expand': Maximize2,
  'eye': Eye,
  'eye-off': EyeOff,
  'filter': Funnel,
  'flag': Flag,
  'flame': Flame,
  'flash': Zap,
  'flask': FlaskConical,
  'folder': Folder,
  'game-controller': Gamepad2,
  'gift': Gift,
  'git-branch': GitBranch,
  'git-compare': GitCompare,
  'git-network': Network,
  'globe': Globe,
  'grid': LayoutGrid,
  'hand-left': Handshake,
  'headphones': Headphones,
  'heart': Heart,
  'help-circle': CircleQuestionMark,
  'home': House,
  'image': Image,
  'images': Images,
  'infinite': Infinity,
  'information-circle': Info,
  'layers': Layers,
  'library': Library,
  'link': Link,
  'list': List,
  'location': MapPin,
  'lock-closed': Lock,
  'log-out': LogOut,
  'logo-youtube': SquarePlay,
  'mail': Mail,
  'mail-unread': MailPlus,
  'medal': Medal,
  'megaphone': Megaphone,
  'menu': Menu,
  'mic': Mic,
  'moon': Moon,
  'notifications': Bell,
  'notifications-off': BellOff,
  'open': ExternalLink,
  'options': SlidersHorizontal,
  'pause': Pause,
  'pause-circle': CirclePause,
  'pencil': Pencil,
  'people': Users,
  'person': User,
  'person-add': UserPlus,
  'person-circle': CircleUser,
  'phone-portrait': Smartphone,
  'pie-chart': ChartPie,
  'pin': Pin,
  'play': Play,
  'play-circle': CirclePlay,
  'pricetag': Tag,
  'pricetags': Tags,
  'radio-button-off': Circle,
  'radio-button-on': CircleDot,
  'receipt': Receipt,
  'refresh': RefreshCw,
  'refresh-circle': RefreshCcw,
  'remove': Minus,
  'remove-circle': CircleMinus,
  'repeat': Repeat,
  'restaurant': UtensilsCrossed,
  'ribbon': Award,
  'rocket': Rocket,
  'sad': Frown,
  'save': Save,
  'school': GraduationCap,
  'search': Search,
  'send': Send,
  'server': HardDrive,
  'settings': Settings,
  'share': Share2,
  'share-social': Share2,
  'shield': Shield,
  'shield-checkmark': ShieldCheck,
  'shirt': Shirt,
  'shuffle': Shuffle,
  'snow': Snowflake,
  // One clean four-point star. `sparkles` adds a stray dot and a tick that
  // collapse into a scribble below ~28px, which is what the Lantern AI button
  // in the top bar was showing — use `sparkle` wherever the glyph is small.
  'sparkle': Sparkle,
  'sparkles': Sparkles,
  'square': Square,
  'star': Star,
  'star-half': StarHalf,
  'stats-chart': ChartColumn,
  'stop': CircleStop,
  'storefront': Store,
  'sunny': Sun,
  'swap-horizontal': ArrowLeftRight,
  'sync': RefreshCw,
  'text': Type,
  'thumbs-down': ThumbsDown,
  'thumbs-up': ThumbsUp,
  'ticket': Ticket,
  'time': Clock,
  'timer': Timer,
  'trash': Trash,
  'trending-up': TrendingUp,
  'trophy': Trophy,
  'volume-medium': Volume2,
  'volume-mute': VolumeX,
  'wallet': Wallet,
  'warning': TriangleAlert,
  'wifi': Wifi,
} as const;

export type AppIconName = keyof typeof APP_ICONS;

/**
 * Narrow an untrusted string — a server-supplied badge icon, a stored
 * preference — to a name this app can actually draw. Call sites holding a
 * literal must NOT use this: they are type-checked instead.
 */
export function isAppIconName(value: unknown): value is AppIconName {
  return typeof value === 'string' && value in APP_ICONS;
}
