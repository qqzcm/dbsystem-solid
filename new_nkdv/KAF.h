#pragma once
#ifndef KAF_H
#define KAF_H

#include "init.h"

double kernel_value(model& our_model, double dist);
double kernel_value_temporal(model& our_model, double time_dist);
bool is_point_in_time_window(model& our_model, double point_time, double cur_time);
double edge_KAF(model& our_model, int edge_index);
double edge_KAF_spatiotemporal(model& our_model, int edge_index, double cur_time);
void NKDV_basic(model& our_model);
void NKDV_spatiotemporal(model& our_model);

//Used in aggregate distance augmentation (ADA)
void augment_preprocess(model& our_model);
//Used in interval augmentation (IA)
void augment_interval_preprocess(model& our_model);

#endif