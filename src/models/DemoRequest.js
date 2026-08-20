import mongoose from 'mongoose';

/**
 * "Book a demo" from the public landing page. Nobody is signed in when this is
 * created — it is a lead, not an account — so it lives on its own and is worked
 * through from the admin console.
 */
const demoRequestSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, index: true },
    phone: { type: String, required: true, trim: true, index: true },
    company: { type: String, default: '', trim: true },
    teamSize: { type: String, default: '', trim: true },
    message: { type: String, default: '', trim: true },

    status: {
      type: String,
      enum: ['new', 'contacted', 'scheduled', 'closed'],
      default: 'new',
      index: true,
    },
    /** Internal notes — who was called, what was agreed. Never shown publicly. */
    notes: { type: String, default: '' },
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    handledAt: { type: Date, default: null },

    /** Where the request came from, in case other surfaces start using it. */
    source: { type: String, default: 'landing' },
  },
  { timestamps: true },
);

demoRequestSchema.index({ status: 1, createdAt: -1 });

export const DemoRequest = mongoose.model('DemoRequest', demoRequestSchema);
