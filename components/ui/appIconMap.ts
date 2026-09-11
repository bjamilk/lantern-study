/// <reference path="./lucideIcons.d.ts" />
// ^ The wildcard module declaration for lucide's per-glyph deep imports lives
// in a global .d.ts beside this file. apps/web's tsconfig only `include`s
// src/, so the file is not picked up ambiently and every glyph below would be
// an implicit `any` (TS7016). This reference pulls it into whichever program
// compiles this file.
/**
 * Every icon the web app can draw, by the app's own name.
 *
 * WHY THIS FILE EXISTS
 * The web app drew ~670 icons from @heroicons/react, whose 24/outline set
 * bakes stroke-width 1.5 into the SVG as a presentation attribute. "Make the
 * outlines bolder" was only expressible as one flat CSS override for every
 * icon at every size (index.css, `svg[data-slot="icon"]`). These are lucide
 * paths behind one component, so weight is a prop the size-aware ramp owns —
 * see appIconStroke.ts.
 *
 * WHY DEEP IMPORTS
 * One import per icon, from 'lucide-react/dist/esm/icons/<file>.mjs', never
 * from the package root. lucide-react 1.41 publishes no `exports` map, so
 * dist/esm/icons/ IS the documented per-icon path. Vite does tree-shake the
 * root barrel, but the barrel is ~4100 modules that every dev server start
 * and every cold build has to parse; deep imports touch exactly the 194
 * glyph modules below.
 *
 * WHY THESE NAMES
 * They are the app's own vocabulary, and they are the SAME names mobile uses
 * (apps/mobile/src/components/ui/appIconMap.ts) — the old glyph names with
 * `-outline` stripped. lucide has no outline/solid split: every icon is a
 * stroke and a solid one is the same icon with `filled`, which is how
 * heroicons' 24/outline + 24/solid pair collapses to one name. The block at
 * the bottom is the web-only surplus: heroicons the web app draws that mobile
 * has never needed. Adding one there is how you extend the set — never a
 * root-barrel import at a call site.
 *
 * There is deliberately NO string-keyed fallback. An unmapped name has to be a
 * TypeScript error; a runtime fallback is how an icon silently becomes a blank
 * square in production.
 */
import AlarmClock from 'lucide-react/dist/esm/icons/alarm-clock.mjs';
import Archive from 'lucide-react/dist/esm/icons/archive.mjs';
import ArrowDown from 'lucide-react/dist/esm/icons/arrow-down.mjs';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.mjs';
import ArrowLeftRight from 'lucide-react/dist/esm/icons/arrow-left-right.mjs';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.mjs';
import ArrowUp from 'lucide-react/dist/esm/icons/arrow-up.mjs';
import AtSign from 'lucide-react/dist/esm/icons/at-sign.mjs';
import Award from 'lucide-react/dist/esm/icons/award.mjs';
import BadgeCheck from 'lucide-react/dist/esm/icons/badge-check.mjs';
import Ban from 'lucide-react/dist/esm/icons/ban.mjs';
import Banknote from 'lucide-react/dist/esm/icons/banknote.mjs';
import Bell from 'lucide-react/dist/esm/icons/bell.mjs';
import BellOff from 'lucide-react/dist/esm/icons/bell-off.mjs';
import BellRing from 'lucide-react/dist/esm/icons/bell-ring.mjs';
import Book from 'lucide-react/dist/esm/icons/book.mjs';
import Bookmark from 'lucide-react/dist/esm/icons/bookmark.mjs';
import BookOpen from 'lucide-react/dist/esm/icons/book-open.mjs';
import Briefcase from 'lucide-react/dist/esm/icons/briefcase.mjs';
import Building2 from 'lucide-react/dist/esm/icons/building-2.mjs';
import Calendar from 'lucide-react/dist/esm/icons/calendar.mjs';
import Camera from 'lucide-react/dist/esm/icons/camera.mjs';
import Car from 'lucide-react/dist/esm/icons/car.mjs';
import ChartColumn from 'lucide-react/dist/esm/icons/chart-column.mjs';
import ChartLine from 'lucide-react/dist/esm/icons/chart-line.mjs';
import ChartPie from 'lucide-react/dist/esm/icons/chart-pie.mjs';
import Check from 'lucide-react/dist/esm/icons/check.mjs';
import CheckCheck from 'lucide-react/dist/esm/icons/check-check.mjs';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.mjs';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.mjs';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.mjs';
import ChevronsLeft from 'lucide-react/dist/esm/icons/chevrons-left.mjs';
import ChevronsRight from 'lucide-react/dist/esm/icons/chevrons-right.mjs';
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up.mjs';
import Circle from 'lucide-react/dist/esm/icons/circle.mjs';
import CircleAlert from 'lucide-react/dist/esm/icons/circle-alert.mjs';
import CircleCheck from 'lucide-react/dist/esm/icons/circle-check.mjs';
import CircleDollarSign from 'lucide-react/dist/esm/icons/circle-dollar-sign.mjs';
import CircleDot from 'lucide-react/dist/esm/icons/circle-dot.mjs';
import CircleMinus from 'lucide-react/dist/esm/icons/circle-minus.mjs';
import CirclePause from 'lucide-react/dist/esm/icons/circle-pause.mjs';
import CirclePlay from 'lucide-react/dist/esm/icons/circle-play.mjs';
import CirclePlus from 'lucide-react/dist/esm/icons/circle-plus.mjs';
import CircleQuestionMark from 'lucide-react/dist/esm/icons/circle-question-mark.mjs';
import CircleStop from 'lucide-react/dist/esm/icons/circle-stop.mjs';
import CircleUser from 'lucide-react/dist/esm/icons/circle-user.mjs';
import CircleX from 'lucide-react/dist/esm/icons/circle-x.mjs';
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check.mjs';
import ClipboardCopy from 'lucide-react/dist/esm/icons/clipboard-copy.mjs';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.mjs';
import Clock from 'lucide-react/dist/esm/icons/clock.mjs';
import Cloud from 'lucide-react/dist/esm/icons/cloud.mjs';
import CloudCheck from 'lucide-react/dist/esm/icons/cloud-check.mjs';
import CloudDownload from 'lucide-react/dist/esm/icons/cloud-download.mjs';
import CloudOff from 'lucide-react/dist/esm/icons/cloud-off.mjs';
import CloudUpload from 'lucide-react/dist/esm/icons/cloud-upload.mjs';
import Contrast from 'lucide-react/dist/esm/icons/contrast.mjs';
import Cookie from 'lucide-react/dist/esm/icons/cookie.mjs';
import Copy from 'lucide-react/dist/esm/icons/copy.mjs';
import CreditCard from 'lucide-react/dist/esm/icons/credit-card.mjs';
import Download from 'lucide-react/dist/esm/icons/download.mjs';
import Ellipsis from 'lucide-react/dist/esm/icons/ellipsis.mjs';
import EllipsisVertical from 'lucide-react/dist/esm/icons/ellipsis-vertical.mjs';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link.mjs';
import Eye from 'lucide-react/dist/esm/icons/eye.mjs';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off.mjs';
import File from 'lucide-react/dist/esm/icons/file.mjs';
import FileText from 'lucide-react/dist/esm/icons/file-text.mjs';
import FileUp from 'lucide-react/dist/esm/icons/file-up.mjs';
import Flag from 'lucide-react/dist/esm/icons/flag.mjs';
import Flame from 'lucide-react/dist/esm/icons/flame.mjs';
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical.mjs';
import Folder from 'lucide-react/dist/esm/icons/folder.mjs';
import FolderPlus from 'lucide-react/dist/esm/icons/folder-plus.mjs';
import Frown from 'lucide-react/dist/esm/icons/face-slightly-frowning.mjs';
import Funnel from 'lucide-react/dist/esm/icons/funnel.mjs';
import Gamepad2 from 'lucide-react/dist/esm/icons/gamepad-2.mjs';
import Gift from 'lucide-react/dist/esm/icons/gift.mjs';
import GitBranch from 'lucide-react/dist/esm/icons/git-branch.mjs';
import GitCompare from 'lucide-react/dist/esm/icons/git-compare.mjs';
import Globe from 'lucide-react/dist/esm/icons/globe.mjs';
import GraduationCap from 'lucide-react/dist/esm/icons/graduation-cap.mjs';
import Handshake from 'lucide-react/dist/esm/icons/handshake.mjs';
import HardDrive from 'lucide-react/dist/esm/icons/hard-drive.mjs';
import Hash from 'lucide-react/dist/esm/icons/hash.mjs';
import Headphones from 'lucide-react/dist/esm/icons/headphones.mjs';
import Heart from 'lucide-react/dist/esm/icons/heart.mjs';
import House from 'lucide-react/dist/esm/icons/house.mjs';
import Image from 'lucide-react/dist/esm/icons/image.mjs';
import Images from 'lucide-react/dist/esm/icons/images.mjs';
import Inbox from 'lucide-react/dist/esm/icons/inbox.mjs';
import Infinity from 'lucide-react/dist/esm/icons/infinity.mjs';
import Info from 'lucide-react/dist/esm/icons/info.mjs';
import Landmark from 'lucide-react/dist/esm/icons/landmark.mjs';
import Layers from 'lucide-react/dist/esm/icons/layers.mjs';
import Layers2 from 'lucide-react/dist/esm/icons/layers-2.mjs';
import LayoutGrid from 'lucide-react/dist/esm/icons/layout-grid.mjs';
import Library from 'lucide-react/dist/esm/icons/library.mjs';
import LifeBuoy from 'lucide-react/dist/esm/icons/life-buoy.mjs';
import Lightbulb from 'lucide-react/dist/esm/icons/lightbulb.mjs';
import Link from 'lucide-react/dist/esm/icons/link.mjs';
import List from 'lucide-react/dist/esm/icons/list.mjs';
import Lock from 'lucide-react/dist/esm/icons/lock.mjs';
import LogOut from 'lucide-react/dist/esm/icons/log-out.mjs';
import Mail from 'lucide-react/dist/esm/icons/mail.mjs';
import MailOpen from 'lucide-react/dist/esm/icons/mail-open.mjs';
import MailPlus from 'lucide-react/dist/esm/icons/mail-plus.mjs';
import MapPin from 'lucide-react/dist/esm/icons/map-pin.mjs';
import Maximize2 from 'lucide-react/dist/esm/icons/maximize-2.mjs';
import Medal from 'lucide-react/dist/esm/icons/medal.mjs';
import Megaphone from 'lucide-react/dist/esm/icons/megaphone.mjs';
import Menu from 'lucide-react/dist/esm/icons/menu.mjs';
import MessageCircle from 'lucide-react/dist/esm/icons/message-circle.mjs';
import MessageCircleMore from 'lucide-react/dist/esm/icons/message-circle-more.mjs';
import MessagesSquare from 'lucide-react/dist/esm/icons/messages-square.mjs';
import Mic from 'lucide-react/dist/esm/icons/mic.mjs';
import Minimize2 from 'lucide-react/dist/esm/icons/minimize-2.mjs';
import Minus from 'lucide-react/dist/esm/icons/minus.mjs';
import Moon from 'lucide-react/dist/esm/icons/moon.mjs';
import Network from 'lucide-react/dist/esm/icons/network.mjs';
import Package from 'lucide-react/dist/esm/icons/package.mjs';
import Paintbrush from 'lucide-react/dist/esm/icons/paintbrush.mjs';
import Palette from 'lucide-react/dist/esm/icons/palette.mjs';
import Paperclip from 'lucide-react/dist/esm/icons/paperclip.mjs';
import PanelLeftClose from 'lucide-react/dist/esm/icons/panel-left-close.mjs';
import PanelLeftOpen from 'lucide-react/dist/esm/icons/panel-left-open.mjs';
import Pause from 'lucide-react/dist/esm/icons/pause.mjs';
import Pencil from 'lucide-react/dist/esm/icons/pencil.mjs';
import Phone from 'lucide-react/dist/esm/icons/phone.mjs';
import Pin from 'lucide-react/dist/esm/icons/pin.mjs';
import Play from 'lucide-react/dist/esm/icons/play.mjs';
import Plus from 'lucide-react/dist/esm/icons/plus.mjs';
import Presentation from 'lucide-react/dist/esm/icons/presentation.mjs';
import Puzzle from 'lucide-react/dist/esm/icons/puzzle.mjs';
import QrCode from 'lucide-react/dist/esm/icons/qr-code.mjs';
import Receipt from 'lucide-react/dist/esm/icons/receipt.mjs';
import Redo2 from 'lucide-react/dist/esm/icons/redo-2.mjs';
import RefreshCcw from 'lucide-react/dist/esm/icons/refresh-ccw.mjs';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.mjs';
import Repeat from 'lucide-react/dist/esm/icons/repeat.mjs';
import Rocket from 'lucide-react/dist/esm/icons/rocket.mjs';
import Save from 'lucide-react/dist/esm/icons/save.mjs';
import Scale from 'lucide-react/dist/esm/icons/scale.mjs';
import Search from 'lucide-react/dist/esm/icons/search.mjs';
import Send from 'lucide-react/dist/esm/icons/send.mjs';
import Settings from 'lucide-react/dist/esm/icons/settings.mjs';
import Share2 from 'lucide-react/dist/esm/icons/share-2.mjs';
import Shield from 'lucide-react/dist/esm/icons/shield.mjs';
import ShieldAlert from 'lucide-react/dist/esm/icons/shield-alert.mjs';
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check.mjs';
import Shirt from 'lucide-react/dist/esm/icons/shirt.mjs';
import ShoppingBag from 'lucide-react/dist/esm/icons/shopping-bag.mjs';
import ShoppingCart from 'lucide-react/dist/esm/icons/shopping-cart.mjs';
import Shuffle from 'lucide-react/dist/esm/icons/shuffle.mjs';
import SignalHigh from 'lucide-react/dist/esm/icons/signal-high.mjs';
import SignalZero from 'lucide-react/dist/esm/icons/signal-zero.mjs';
import SlidersHorizontal from 'lucide-react/dist/esm/icons/sliders-horizontal.mjs';
import Smartphone from 'lucide-react/dist/esm/icons/smartphone.mjs';
import Smile from 'lucide-react/dist/esm/icons/smile.mjs';
import Snowflake from 'lucide-react/dist/esm/icons/snowflake.mjs';
import Sparkle from 'lucide-react/dist/esm/icons/sparkle.mjs';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.mjs';
import Square from 'lucide-react/dist/esm/icons/square.mjs';
import SquareCheckBig from 'lucide-react/dist/esm/icons/square-check-big.mjs';
import SquarePen from 'lucide-react/dist/esm/icons/square-pen.mjs';
import SquarePlay from 'lucide-react/dist/esm/icons/square-play.mjs';
import Star from 'lucide-react/dist/esm/icons/star.mjs';
import StarHalf from 'lucide-react/dist/esm/icons/star-half.mjs';
import Store from 'lucide-react/dist/esm/icons/store.mjs';
import Sun from 'lucide-react/dist/esm/icons/sun.mjs';
import Tag from 'lucide-react/dist/esm/icons/tag.mjs';
import Tags from 'lucide-react/dist/esm/icons/tags.mjs';
import ThumbsDown from 'lucide-react/dist/esm/icons/thumbs-down.mjs';
import ThumbsUp from 'lucide-react/dist/esm/icons/thumbs-up.mjs';
import Ticket from 'lucide-react/dist/esm/icons/ticket.mjs';
import Timer from 'lucide-react/dist/esm/icons/timer.mjs';
import Trash from 'lucide-react/dist/esm/icons/trash.mjs';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up.mjs';
import TriangleAlert from 'lucide-react/dist/esm/icons/triangle-alert.mjs';
import Trophy from 'lucide-react/dist/esm/icons/trophy.mjs';
import Truck from 'lucide-react/dist/esm/icons/truck.mjs';
import Type from 'lucide-react/dist/esm/icons/type.mjs';
import Undo2 from 'lucide-react/dist/esm/icons/undo-2.mjs';
import Upload from 'lucide-react/dist/esm/icons/upload.mjs';
import User from 'lucide-react/dist/esm/icons/user.mjs';
import UserMinus from 'lucide-react/dist/esm/icons/user-minus.mjs';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.mjs';
import Users from 'lucide-react/dist/esm/icons/users.mjs';
import UtensilsCrossed from 'lucide-react/dist/esm/icons/utensils-crossed.mjs';
import Volume2 from 'lucide-react/dist/esm/icons/volume-2.mjs';
import VolumeX from 'lucide-react/dist/esm/icons/volume-x.mjs';
import Wallet from 'lucide-react/dist/esm/icons/wallet.mjs';
import Wifi from 'lucide-react/dist/esm/icons/wifi.mjs';
import X from 'lucide-react/dist/esm/icons/x.mjs';
import Zap from 'lucide-react/dist/esm/icons/zap.mjs';
import ZoomIn from 'lucide-react/dist/esm/icons/zoom-in.mjs';
import ZoomOut from 'lucide-react/dist/esm/icons/zoom-out.mjs';

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

  // ===== Web-only glyphs =====
  // Heroicons the web app draws that mobile's set has no name for. Keep this
  // list alphabetical, and keep every entry a deep import like the rest.
  'badge-check': BadgeCheck,
  'book-open': BookOpen,
  'brush': Paintbrush,
  'call': Phone,
  'cellular-off': SignalZero,
  'chevrons-back': ChevronsLeft,
  'chevrons-forward': ChevronsRight,
  'clipboard-check': ClipboardCheck,
  'clipboard-copy': ClipboardCopy,
  'cloud': Cloud,
  'contract': Minimize2,
  'currency': CircleDollarSign,
  'document-upload': FileUp,
  'folder-add': FolderPlus,
  'happy': Smile,
  'hashtag': Hash,
  'inbox': Inbox,
  'institution': Landmark,
  'lifebuoy': LifeBuoy,
  'mail-open': MailOpen,
  'notifications-alert': BellRing,
  'panel-left-close': PanelLeftClose,
  'panel-left-open': PanelLeftOpen,
  'person-remove': UserMinus,
  'puzzle': Puzzle,
  'qr-code': QrCode,
  'scale': Scale,
  'shield-warning': ShieldAlert,
  'truck': Truck,
  'upload': Upload,
  'zoom-in': ZoomIn,
  'zoom-out': ZoomOut,
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
