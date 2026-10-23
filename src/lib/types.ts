export type Segment = "beleza" | "estetica" | "psicologia_terapias" | "outros";
export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";

export type DirectoryItem = {
  id: string;
  slug: string;
  name: string;
  segment: Segment;
  subcategory: string | null;
  tagline: string | null;
  city: string | null;
  state: string | null;
  logo_url: string | null;
  hero_image: string | null;
  whatsapp: string | null;
  whatsapp_message: string | null;
  rating_avg: number;
  rating_count: number;
  min_price: number | null;
  service_count: number;
  niche_name?: string | null;
  niche_icon?: string | null;
};

export type Business = DirectoryItem & {
  description: string | null;
  phone: string | null;
  address: string | null;
  instagram: string | null;
};

export type Service = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  price: number;
  duration_min: number;
  image_url: string | null;
  sort_order: number;
  bookable_online?: boolean;
};

export type Professional = {
  id: string;
  name: string;
  role: string | null;
  bio: string | null;
  photo_url: string | null;
  specialties: string[];
};

export type BusinessHour = {
  weekday: number;
  open_time: string | null;
  close_time: string | null;
  closed: boolean;
};
